# process & child\_process

## Wolai 目录

*   [主进程](#主进程)

*   [子进程](#子进程)

    *   [核心API](#核心api)
    *   [child\_process.spawn()](#child_processspawn)
    *   [child\_process.fork()](#child_processfork)

*   [进程间通信](#进程间通信)

    *   [创建IPC通道](#创建ipc通道)
    *   [父进程监听IPC](#父进程监听ipc)
    *   [子进程监听消息](#子进程监听消息)

## 主进程

node在c++部分初始化，会将主进程执行状态、执行上下文、打开的文件、根目录、工作目录、收到的信号、信号处理函数、代码段、数据段的信息、进程id、执行时间、退出码等初始化完毕。

随后会逐步将env等属性挂载到主进程上。

## 子进程

### 核心API

*   `child_process.spawn()`

    *   最基础的创建新进程的方法，接收三个参数：命令、命令参数数组、其它选项

*   `child_process.fork()`

    *   衍生新的node.js进程，父子进程建立IPC通信，

*   `child_process.exec()`

    *   衍生shell，并在 ishell中执行命令

    *   数据量不大

*   `child_process.execFile()`

    *   衍生命令，默认不衍生shell，效率高一点

*   `ChildProcess`类

    *   调用上述方法之后，会返回一个`ChildProcess`类的实例

### child\_process.spawn()

`spawn()`中会先初始化一个`ChildProcess`的实例，然后调用这个实例的`.spawn()`方法。

```javascript
function spawn(file, args, options) {
  // 创建一个新的子进程实例
  const child = new ChildProcess();
  // 调用子进程实例的spawn方法
  child.spawn(options);
  return child;
}
```

在spawn方法中，会生成用于IPC的stdio配置。

```javascript
ChildProcess.prototype.spawn = function(options) {
  let i = 0;
  
  // 默认以管道的形式进行进程间通信
  let stdio = options.stdio || 'pipe';
  // 创建stdio
  stdio = getValidStdio(stdio, false);
  
  const ipc = stdio.ipc;
  // ipc文件描述符
  const ipcFd = stdio.ipcFd;
  stdio = options.stdio = stdio.stdio;
  // 默认以json格式进行序列化
  const serialization = options.serialization || 'json';

  if (ipc !== undefined) {
    if (options.envPairs === undefined)
      options.envPairs = [];
    else if (!ArrayIsArray(options.envPairs)) {
      throw new ERR_INVALID_ARG_TYPE('options.envPairs',
                                     'Array',
                                     options.envPairs);
    }
    // 传递ipc文件描述符及序列化方式
    ArrayPrototypePush(options.envPairs, `NODE_CHANNEL_FD=${ipcFd}`);
    ArrayPrototypePush(options.envPairs,
                       `NODE_CHANNEL_SERIALIZATION_MODE=${serialization}`);
  }
  this.spawnfile = options.file;
  
  // 创建子进程，会调用到c++层，并最终通过libuv的uv_spawn方法创建一个新的进程
  const err = this._handle.spawn(options);

  // 为父进程创建一个.send()方法，.send()方法用于向子进程传递消息。
  // 同时，父进程开始监听IPC消息
  if (ipc !== undefined) setupChannel(this, ipc, serialization);

  return err;
};
```

### child\_process.fork()

fork方法最终会调用到spawn方法。

```javascript
function fork(modulePath /* , args, options */) {


  if (typeof options.stdio === 'string') {
    options.stdio = stdioStringToArray(options.stdio, 'ipc');
  } else if (!ArrayIsArray(options.stdio)) {
    // 默认以继承的方式创建子进程的stdio
    // 如果silent为true，则子进程的stdio输出到父进程
    options.stdio = stdioStringToArray(
      options.silent ? 'pipe' : 'inherit',
      'ipc');
  } else if (!ArrayPrototypeIncludes(options.stdio, 'ipc')) {
    throw new ERR_CHILD_PROCESS_IPC_REQUIRED('options.stdio');
  }

  options.execPath = options.execPath || process.execPath;
  options.shell = false;
  
  // 最终调用到spawn方法
  return spawn(options.execPath, args, options);
}

```

## 进程间通信

父进程在创建子进程之前，会先创建好IPC，并对这个IPC进行监听。随后，将IPC的fd传递给子进程，子进程根据fd连接这个IPC，从而建立起父子进程的通信机制。

### 创建IPC通道

`spawn()`方法中会调用`getValidStdio()`方法来生成stdio：

```javascript
ChildProcess.prototype.spawn = function(options) {
  stdio = getValidStdio(stdio, false);
}

```

在`getValidStdio()`中会创建一个新的ipc，并返回ipc、ipcFd。

```javascript
function getValidStdio(stdio, sync) {
  let ipc;
  let ipcFd;

  stdio = ArrayPrototypeReduce(stdio, (acc, stdio, i) => {
  
    // ......
    } else if (stdio === 'ipc') {
      
      // 调用c++层，创建IPC
      ipc = new Pipe(PipeConstants.IPC);
      ipcFd = i;

      ArrayPrototypePush(acc, {
        type: 'pipe',
        handle: ipc,
        ipc: true
      });
    } 
    // ......
  }
 
  return { stdio, ipc, ipcFd };
}
```

### 父进程监听IPC

同样的，在`spawn()`方法的最后，会调用`setupChannel()`方法来建立连接。

```javascript
ChildProcess.prototype.spawn = function(options) {
  stdio = getValidStdio(stdio, false);
  
  if (ipc !== undefined) setupChannel(this, ipc, serialization);
}
```

在`onread()`方法中，父进程接收子进程传来的handel、buffer，并进程处理：

```javascript
function setupChannel(target, channel, serializationMode) {
  // 主进程处理接收到的数据
  channel.onread = function(arrayBuffer) {
    // 接收子进程传递过来的 handel
    const recvHandle = channel.pendingHandle;
    if (arrayBuffer) {
      // 获取到对应的buffer
      const pool = new Uint8Array(arrayBuffer, offset, nread);
      if (recvHandle)
        pendingHandle = recvHandle;
        
      for (const message of parseChannelMessages(channel, pool)) {
        // 处理接收到的数据
        handleMessage(message, pendingHandle, true);
      }
    } 
  };
  
  function handleMessage(message, handle, internal) {
    const eventName = (internal ? 'internalMessage' : 'message');
    process.nextTick(emit, eventName, message, handle);
  }
}
```

父进程通过`send()`方法向子进程传递消息：

```javascript
function setupChannel(target, channel, serializationMode) {

  target.send = function(message, handle, options, callback) {
    if (this.connected) {
      return this._send(message, handle, options, callback);
    }
  };

  target._send = function(message, handle, options, callback) {
    // 写入数据
    const err = writeChannelMessage(channel, req, message, handle);
  }
}

writeChannelMessage(channel, req, message, handle) {
  const ser = new ChildProcessSerializer();
  // 进行序列化
  ser.writeValue(message);
  // 写入buffer
  const result = channel.writeBuffer(req, buffer, handle);
},

```

### 子进程监听消息

在进程bootstrap的阶段，会调用`setupChildProcessIpcChannel()`方法，会尝试从`process.env.NODE_CHANNEL_FD`字段中获取IPC的fd。如果存在该fd，则表明这个进程是一个子进程：

```javascript
function setupChildProcessIpcChannel() {
  if (process.env.NODE_CHANNEL_FD) {
    const assert = require('internal/assert');
    // 尝试获取 fd
    const fd = NumberParseInt(process.env.NODE_CHANNEL_FD, 10);
    // 如果fd存在
    assert(fd >= 0);
    
    const serializationMode =
      process.env.NODE_CHANNEL_SERIALIZATION_MODE || 'json';
    delete process.env.NODE_CHANNEL_SERIALIZATION_MODE;
    // 则调用_forkChild方法
    require('child_process')._forkChild(fd, serializationMode);
    assert(process.send);
  }
}
```

然后再`_forkChild()`方法中建立与IPC的链接：

```javascript
function _forkChild(fd, serializationMode) {

  const p = new Pipe(PipeConstants.IPC);
  // 子进连接到IPC中
  p.open(fd);
  p.unref();
  // 同样，子进程调用setupChannel方法
  // 添加send方法，向IPC写入数据
  // 添加onread方法，用于监听IPC传递过来的数据
  const control = setupChannel(process, p, serializationMode);
}
```
