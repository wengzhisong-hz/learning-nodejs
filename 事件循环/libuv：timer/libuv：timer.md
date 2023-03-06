# libuv：timer

# 定时器

在libuv中，定时器是以最小堆来实现的，最快过期的定时器是堆的根节点。

```c
struct uv_timer_s {
  UV_HANDLE_FIELDS   // 继承了基类
  UV_TIMER_PRIVATE_FIELDS
};

#define UV_TIMER_PRIVATE_FIELDS  \
  uv_timer_cb timer_cb;      \ // 定时器回调函数
  void* heap_node[3];      \ // 定时器在堆中的位置
  uint64_t timeout;        \
  uint64_t repeat;        \
  uint64_t start_id;      \

// heap_node结构 
struct heap_node {
  struct heap_node* left;
  struct heap_node* right;
  struct heap_node* parent;
};
```

timers的一些操作如下：

```c
UV_EXTERN int uv_timer_init(uv_loop_t*, uv_timer_t* handle);
UV_EXTERN int uv_timer_start(uv_timer_t* handle,
                             uv_timer_cb cb,
                             uint64_t timeout,
                             uint64_t repeat);
UV_EXTERN int uv_timer_stop(uv_timer_t* handle);
UV_EXTERN int uv_timer_again(uv_timer_t* handle);
UV_EXTERN void uv_timer_set_repeat(uv_timer_t* handle, uint64_t repeat);
```

## 初始化timer

```c
int uv_timer_init(uv_loop_t* loop, uv_timer_t* handle) {
  uv__handle_init(loop, (uv_handle_t*)handle, UV_TIMER);
  handle->timer_cb = NULL;
  handle->timeout = 0;
  handle->repeat = 0;
  return 0;
}
```

## timer start

```c
int uv_timer_start(uv_timer_t* handle,
                   uv_timer_cb cb,
                   uint64_t timeout,
                   uint64_t repeat) {
  uint64_t clamped_timeout;
  // 如果这个计时器句柄是关闭的或者回调函数为 NULL
  if (uv__is_closing(handle) || cb == NULL)
    return UV_EINVAL;
  // 启动一个定时器的时候，会先进行停止操作
  if (uv__is_active(handle))
    uv_timer_stop(handle);
  // 计算超时时间，handle->loop->time 为event loop中的绝对时间
  clamped_timeout = handle->loop->time + timeout;
  if (clamped_timeout < timeout)
    clamped_timeout = (uint64_t) -1;
    
  // 以下为初始化timer handle
    
  handle->timer_cb = cb;
  handle->timeout = clamped_timeout;
  handle->repeat = repeat;
  /* start_id is the second index to be compared in timer_less_than() */
  handle->start_id = handle->loop->timer_counter++;

  // 将这个定时器的handle插入最小堆中
  heap_insert(timer_heap(handle->loop),
              (struct heap_node*) &handle->heap_node,
              timer_less_than);
  // 激活这个handle
  uv__handle_start(handle);

  return 0;
}
```

## uv\_timer\_stop

```c
int uv_timer_stop(uv_timer_t* handle) {
  if (!uv__is_active(handle))
    return 0;
  // 从最小堆中移除定时器
  heap_remove(timer_heap(handle->loop),
              (struct heap_node*) &handle->heap_node,
              timer_less_than);
  // 清除对应的handle
  uv__handle_stop(handle);

  return 0;
}
```

## 处理timer handle

我们再来看看在event loop中是怎么处理timer的：

```c
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
 
  // 其他逻辑....
  while (r != 0 && loop->stop_flag == 0) {
    // 其他逻辑....
      
    // event loop在此处理timer handle
    uv__run_timers(loop);
    
  // 其他逻辑....
}
```

让我们来看看`uv__run_timers`：

```c
void uv__run_timers(uv_loop_t* loop) {
  struct heap_node* heap_node;
  uv_timer_t* handle;

  for (;;) {
    // 从最小堆中获取根节点的timer，即timeout值为最小的那个timer
    heap_node = heap_min(timer_heap(loop));
    if (heap_node == NULL)
      break;

    handle = container_of(heap_node, uv_timer_t, heap_node);
    // 如果根节点timer的timeout 大于 event loop中的timeout，那么说明这个timer还没有过期，则跳过 uv__run_timers
    if (handle->timeout > loop->time)
      break;
    // 如果timer过期了，则先移除这个timer节点。
    uv_timer_stop(handle);
    // 如果设置了repeat，则会重新插入最小堆中
    uv_timer_again(handle);
    // 调用timer的callback
    handle->timer_cb(handle);
  }
}
```

`uv__run_timers`会从最小堆中寻找已经过期了的定时器，并执行对应的cb。所以在nodejs中，定时器永远是超时了才被调用，并不是一个精确的时间节点。
