# I/O

## I/O时间分配

在进入I/O（轮询）阶段，event loop会先检查timer callback。默认情况下会在调用`epoll_wait`的时候添加一个超时时间：

```c
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  // ...
  while (r != 0 && loop->stop_flag == 0) {
    // ...
    timeout = 0;
    if ((mode == UV_RUN_ONCE && can_sleep) || mode == UV_RUN_DEFAULT)
        // 计算I/O超时时间
      timeout = uv__backend_timeout(loop);
    uv__io_poll(loop, timeout);
    // ...
  }
}
```

具体逻辑是：

```c
static int uv__backend_timeout(const uv_loop_t* loop) {
    // 当：
    // 没有活动的handle
    // 或:
    // 有活动的request 且 pending、idle、closing handle为空
    // 则 调用uv__next_timeout
    // 否则 返回0，不阻塞
  if (loop->stop_flag == 0 &&
      /* uv__loop_alive(loop) && */
      (uv__has_active_handles(loop) || uv__has_active_reqs(loop)) &&
      QUEUE_EMPTY(&loop->pending_queue) &&
      QUEUE_EMPTY(&loop->idle_handles) &&
      (loop->flags & UV_LOOP_REAP_CHILDREN) == 0 &&
      loop->closing_handles == NULL)
    return uv__next_timeout(loop);
  return 0;
}

int uv__next_timeout(const uv_loop_t* loop) {
  const struct heap_node* heap_node;
  const uv_timer_t* handle;
  uint64_t diff;
	// 从最小堆中获取最近将要过期的timer
  heap_node = heap_min(timer_heap(loop));
    // 如果堆中没有timer，则可以阻塞
  if (heap_node == NULL)
    return -1; /* block indefinitely */
    // 如果timer的过期时间小于一个event loop的时间，则不阻塞
  handle = container_of(heap_node, uv_timer_t, heap_node);
  if (handle->timeout <= loop->time)
    return 0;
  // 计算出阻塞时间
  diff = handle->timeout - loop->time;
  if (diff > INT_MAX)
    diff = INT_MAX;

  return (int) diff;
}
```

最后这个时间会被传入`epoll_wait`的timeout参数：

```c
int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout);
```

这个timeout为-1的时候，表示本次轮询阻塞至fd就绪，0表示立即返回，不阻塞；如果设定上面传过来的diff，则表示等待diff后，如果此时fd还未就绪则返回。返回之后，不会再阻塞线程，等待fd就绪之后再行处理即可。

简单的说，libuv会合理分配I/O与timer的时间。当有要过期的timer的时候，会轮询阻塞一小段不影响timer的时间，这段时间之后再执行timer。

不难看出，libuv会尽可能的维持处于I/O的状态。

## I/O观察者

libuv的I/O handle基于观察者模式。我来来大致了解下：

```c
struct uv__io_s {
    // 回调
  uv__io_cb cb;
    // pending的事件队列
  void* pending_queue[2];
    // 观察者队列
  void* watcher_queue[2];
    // 被pending的事件
  unsigned int pevents; /* Pending event mask i.e. mask at next tick. */
    // 当前的事件
  unsigned int events;  /* Current event mask. */
  int fd;
  UV_IO_PRIVATE_PLATFORM_FIELDS
};

typedef struct uv__io_s uv__io_t;

// 初始化观察者
void uv__io_init(uv__io_t* w, uv__io_cb cb, int fd) {
  assert(cb != NULL);
  assert(fd >= -1);
  QUEUE_INIT(&w->pending_queue);
  QUEUE_INIT(&w->watcher_queue);
  w->cb = cb;
  w->fd = fd;
  w->events = 0;
  w->pevents = 0;
}

```

## 注册、移除I/O观察者

注册：

```c
void uv__io_start(uv_loop_t* loop, uv__io_t* w, unsigned int events) {
  assert(0 == (events & ~(POLLIN | POLLOUT | UV__POLLRDHUP | UV__POLLPRI)));
  assert(0 != events);
  assert(w->fd >= 0);
  assert(w->fd < INT_MAX);

  w->pevents |= events;
  maybe_resize(loop, w->fd + 1);

#if !defined(__sun)
  if (w->events == w->pevents)
    return;
#endif

  if (QUEUE_EMPTY(&w->watcher_queue))
    QUEUE_INSERT_TAIL(&loop->watcher_queue, &w->watcher_queue);

  if (loop->watchers[w->fd] == NULL) {
      // 将I/O观察者映射到loop->watchers中
    loop->watchers[w->fd] = w;
    loop->nfds++;
  }
}
```

移除：

```c
void uv__io_stop(uv_loop_t* loop, uv__io_t* w, unsigned int events) {
  assert(0 == (events & ~(POLLIN | POLLOUT | UV__POLLRDHUP | UV__POLLPRI)));
  assert(0 != events);

  if (w->fd == -1)
    return;

  assert(w->fd >= 0);

  if ((unsigned) w->fd >= loop->nwatchers)
    return;

  w->pevents &= ~events;
    // 当没有pending的事件
  if (w->pevents == 0) {
    QUEUE_REMOVE(&w->watcher_queue);
    QUEUE_INIT(&w->watcher_queue);
    w->events = 0;

    if (w == loop->watchers[w->fd]) {
      assert(loop->nfds > 0);
        // 移除观察者的映射关系
      loop->watchers[w->fd] = NULL;
      loop->nfds--;
    }
  }
  else if (QUEUE_EMPTY(&w->watcher_queue))
    QUEUE_INSERT_TAIL(&loop->watcher_queue, &w->watcher_queue);
}
```

## 执行I/O轮询

让我们来看下event loop中`uv__io_poll`发生了什么：

```c
void uv__io_poll(uv_loop_t* loop, int timeout) {
  struct pollfd events[1024];
  struct pollfd pqry;
  struct pollfd* pe;
  struct poll_ctl pc;
  QUEUE* q;
  uv__io_t* w;
  uint64_t base;
  uint64_t diff;
  int have_signals;
  int nevents;
  int count;
  int nfds;
  int i;
  int rc;
  int add_failed;
  int user_timeout;
  int reset_timeout;

  if (loop->nfds == 0) {
    assert(QUEUE_EMPTY(&loop->watcher_queue));
    return;
  }
	// 如果观察者队列不为空
  while (!QUEUE_EMPTY(&loop->watcher_queue)) {
      // 获取队列的头部节点
    q = QUEUE_HEAD(&loop->watcher_queue);
    QUEUE_REMOVE(q);
    QUEUE_INIT(q);
	// 获取I/O观察者的数据，即 uv__io_s
    w = QUEUE_DATA(q, uv__io_t, watcher_queue);
    assert(w->pevents != 0);
    assert(w->fd >= 0);
    assert(w->fd < (int) loop->nwatchers);
	// 初始化epoll的events fd
    pc.events = w->pevents;
    pc.fd = w->fd;

    add_failed = 0;
    if (w->events == 0) {
      pc.cmd = PS_ADD;
        // 调用epoll_ctl 修改fd上的事件
      if (pollset_ctl(loop->backend_fd, &pc, 1)) {
        if (errno != EINVAL) {
          assert(0 && "Failed to add file descriptor (pc.fd) to pollset");
          abort();
        }
        /* Check if the fd is already in the pollset */
        pqry.fd = pc.fd;
        rc = pollset_query(loop->backend_fd, &pqry);
        switch (rc) {
        case -1:
          assert(0 && "Failed to query pollset for file descriptor");
          abort();
        case 0:
          assert(0 && "Pollset does not contain file descriptor");
          abort();
        }
        /* If we got here then the pollset already contained the file descriptor even though
         * we didn't think it should. This probably shouldn't happen, but we can continue. */
        add_failed = 1;
      }
    }
    if (w->events != 0 || add_failed) {
      /* Modify, potentially removing events -- need to delete then add.
       * Could maybe mod if we knew for sure no events are removed, but
       * content of w->events is handled above as not reliable (falls back)
       * so may require a pollset_query() which would have to be pretty cheap
       * compared to a PS_DELETE to be worth optimizing. Alternatively, could
       * lazily remove events, squelching them in the mean time. */
      pc.cmd = PS_DELETE;
      if (pollset_ctl(loop->backend_fd, &pc, 1)) {
        assert(0 && "Failed to delete file descriptor (pc.fd) from pollset");
        abort();
      }
      pc.cmd = PS_ADD;
      if (pollset_ctl(loop->backend_fd, &pc, 1)) {
        assert(0 && "Failed to add file descriptor (pc.fd) to pollset");
        abort();
      }
    }

    w->events = w->pevents;
  }

  assert(timeout >= -1);
  base = loop->time;
  count = 48; /* Benchmarks suggest this gives the best throughput. */

  if (uv__get_internal_fields(loop)->flags & UV_METRICS_IDLE_TIME) {
    reset_timeout = 1;
    user_timeout = timeout;
    timeout = 0;
  } else {
    reset_timeout = 0;
  }

  for (;;) {
    /* Only need to set the provider_entry_time if timeout != 0. The function
     * will return early if the loop isn't configured with UV_METRICS_IDLE_TIME.
     */
    if (timeout != 0)
      uv__metrics_set_provider_entry_time(loop);

    nfds = pollset_poll(loop->backend_fd,
                        events,
                        ARRAY_SIZE(events),
                        timeout);

    /* Update loop->time unconditionally. It's tempting to skip the update when
     * timeout == 0 (i.e. non-blocking poll) but there is no guarantee that the
     * operating system didn't reschedule our process while in the syscall.
     */
    SAVE_ERRNO(uv__update_time(loop));

    if (nfds == 0) {
      if (reset_timeout != 0) {
        timeout = user_timeout;
        reset_timeout = 0;
        if (timeout == -1)
          continue;
        if (timeout > 0)
          goto update_timeout;
      }

      assert(timeout != -1);
      return;
    }

    if (nfds == -1) {
      if (errno != EINTR) {
        abort();
      }

      if (reset_timeout != 0) {
        timeout = user_timeout;
        reset_timeout = 0;
      }

      if (timeout == -1)
        continue;

      if (timeout == 0)
        return;

      /* Interrupted by a signal. Update timeout and poll again. */
      goto update_timeout;
    }

    have_signals = 0;
    nevents = 0;

    assert(loop->watchers != NULL);
    loop->watchers[loop->nwatchers] = (void*) events;
    loop->watchers[loop->nwatchers + 1] = (void*) (uintptr_t) nfds;

    for (i = 0; i < nfds; i++) {
      pe = events + i;
      pc.cmd = PS_DELETE;
      pc.fd = pe->fd;

      /* Skip invalidated events, see uv__platform_invalidate_fd */
      if (pc.fd == -1)
        continue;

      assert(pc.fd >= 0);
      assert((unsigned) pc.fd < loop->nwatchers);

      w = loop->watchers[pc.fd];

      if (w == NULL) {
        /* File descriptor that we've stopped watching, disarm it.
         *
         * Ignore all errors because we may be racing with another thread
         * when the file descriptor is closed.
         */
        pollset_ctl(loop->backend_fd, &pc, 1);
        continue;
      }

      /* Run signal watchers last.  This also affects child process watchers
       * because those are implemented in terms of signal watchers.
       */
      if (w == &loop->signal_io_watcher) {
        have_signals = 1;
      } else {
        uv__metrics_update_idle_time(loop);
        w->cb(loop, w, pe->revents);
      }

      nevents++;
    }

    uv__metrics_inc_events(loop, nevents);
    if (reset_timeout != 0) {
      timeout = user_timeout;
      reset_timeout = 0;
      uv__metrics_inc_events_waiting(loop, nevents);
    }

    if (have_signals != 0) {
      uv__metrics_update_idle_time(loop);
      loop->signal_io_watcher.cb(loop, &loop->signal_io_watcher, POLLIN);
    }

    loop->watchers[loop->nwatchers] = NULL;
    loop->watchers[loop->nwatchers + 1] = NULL;

    if (have_signals != 0)
      return;  /* Event loop should cycle now so don't poll again. */

    if (nevents != 0) {
      if (nfds == ARRAY_SIZE(events) && --count != 0) {
        /* Poll for more events but don't block this time. */
        timeout = 0;
        continue;
      }
      return;
    }

    if (timeout == 0)
      return;

    if (timeout == -1)
      continue;

update_timeout:
    assert(timeout > 0);

    diff = loop->time - base;
    if (diff >= (uint64_t) timeout)
      return;

    timeout -= diff;
  }
}

```























