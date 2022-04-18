# cluster

## Wolai 目录

*   [核心API](#核心api)
*   [Master进程](#master进程)
*   [Work进程](#work进程)
*   [负载均衡](#负载均衡)

## 核心API

*   `cluster`实例

    *   `.fork()`创建子进程

    *   `isMaster`

    *   `.isWork`

    *   `message`事件

*   `Worker`类

    *   `.send()`向集群内的其它进程发送消息

## Master进程

master进程是一个`EventEmitter`实例：

```javascript
const cluster = new EventEmitter();
cluster.isWorker = false;
cluster.isMaster = true;
cluster.workers = {};
cluster.settings = {};

```

master进程通过`fork()`方法创建子进程，最终调用到`child_process.fork()`方法（当前版本的node在此处使用spawn重新实现了一遍fork方法）:

```javascript
cluster.fork = function(env) {
  // 配置master
  cluster.setupPrimary();
  const id = ++ids;
  // 创建子进程
  const workerProcess = createWorkerProcess(id, env);
  const worker = new Worker({
    id: id,
    process: workerProcess
  });
  return worker;
};

function createWorkerProcess(id, env) {
  const workerEnv = { ...process.env, ...env, NODE_UNIQUE_ID: `${id}` };
  const execArgv = [...cluster.settings.execArgv];
  const debugArgRegex = /--inspect(?:-brk|-port)?|--debug-port/;
  const nodeOptions = process.env.NODE_OPTIONS || '';
  
  // 最终调用到fork方法
  // 在cluster模块中，重新用child_process.spawn实现了fork方法
  return fork(cluster.settings.exec, cluster.settings.args, {
    cwd: cluster.settings.cwd,
    env: workerEnv,
    serialization: cluster.settings.serialization,
    silent: cluster.settings.silent,
    windowsHide: cluster.settings.windowsHide,
    execArgv: execArgv,
    stdio: cluster.settings.stdio,
    gid: cluster.settings.gid,
    uid: cluster.settings.uid
  });
}

```

创建完子进程之后，主进程和子进程之间通过IPC来传递消息和handel。

## Work进程

worker类同样也继承了`EventEmitter`类。

```javascript
function Worker(options) {
  if (!(this instanceof Worker))
    return new Worker(options);

  ReflectApply(EventEmitter, this, []);
}

Worker.prototype.send = function() {
  // 通过createWorkerProcess创建的子进程的send方法来传递消息和handel给其它进程
  return ReflectApply(this.process.send, this.process, arguments);
};

```

## 负载均衡

主进程在`queryServer`方法中进行消息的分发：

```javascript
function queryServer(worker, message) {
  if (handle === undefined) {
    let address = message.address;
    if (schedulingPolicy !== SCHED_RR ||
        message.addressType === 'udp4' ||
        message.addressType === 'udp6') {
      handle = new SharedHandle(key, address, message);
    } else {
      // 非UDP使用rr策略
      handle = new RoundRobinHandle(key, address, message);
    }
    handles.set(key, handle);
  }
  // 向rr中添加初始的worker
  handle.add(worker, (errno, reply, handle) => {
    // ...
  });
}
```

`RoundRobinHandle`会监听fd或者某个端口：

```javascript
function RoundRobinHandle(key, address, { port, fd, flags }) {
  this.key = key;
  this.all = new SafeMap();
  this.free = new SafeMap();
  this.handles = [];
  this.handle = null;
  this.server = net.createServer(assert.fail);

  // 监听 fd / 端口地址
  if (fd >= 0)
    this.server.listen({ fd });
  else if (port >= 0) {
    this.server.listen({
      port,
      host: address,
      ipv6Only: Boolean(flags & constants.UV_TCP_IPV6ONLY),
    });
  } else
    this.server.listen(address);

  this.server.once('listening', () => {
    this.handle = this.server._handle;
    // 建立监听的时候，会注册 distribute 方法，
    // 当产生请求的时候，会调用 distribute 方法来分配给子进程
    this.handle.onconnection = (err, handle) => this.distribute(err, handle);
    this.server._handle = null;
    this.server = null;
  });
}
```

`distribute`方法会从从空闲队列中取出一个进程，然后将处理请求的事项移交给这个进程。其中核心的逻辑是`handoff`方法。`handoff`方法会通过递归调用自身，确保将处理完message、handle的worker重新添加到free队列中，如此周而复始：

```javascript
RoundRobinHandle.prototype.distribute = function(err, handle) {
  ArrayPrototypePush(this.handles, handle);
  const [ workerEntry ] = this.free; 
  
  if (ArrayIsArray(workerEntry)) {
    // 获取某个空闲的进程
    const { 0: workerId, 1: worker } = workerEntry;
    // 将这个进程从空闲队列中移除
    this.free.delete(workerId);
    // 将本次的message、handle移交给这个进程
    this.handoff(worker);
  }
};

RoundRobinHandle.prototype.handoff = function(worker) {
  // 如果当前worker已经处于关闭状态，则终止递归
  if (!this.all.has(worker.id)) {
    return;
  }
  // 尝试从this.handles队列中获取handle
  const handle = ArrayPrototypeShift(this.handles);
  
  // 如果本次master进程接收到的handle已经处理完毕
  // 则会重新向空闲队列中加入这个worker
  if (handle === undefined) {
    this.free.set(worker.id, worker);
    return;
  }
  // 将消息、处理消息的handel函数发送给空闲的worker
  // sendHelper 底层依赖于 process.send()
  sendHelper(worker.process, message, handle, (reply) => {
    if (reply.accepted)
      // 成功
      handle.close();
    else
      // 如果不成功，则进行另外一次的分配
      this.distribute(0, handle);
      
    // 注意，这里是一个递归
    // 每进行一次成功的handoff，都会立即再次调用handoff一次，目的是：
    // 1. 确保能够在出错的情况下，再次发起一次分配
    // 2. 在成功处理完本次任务之后，将处理本次handle、message的worker重新加入free队列
    this.handoff(worker);
  });
};

```

由此，我们也能够看出，cluster是通过在不同的进程中传递消息及句柄（handle）来实现进程间通信的。
