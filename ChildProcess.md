# child_process

## 核心API

- `ChildProcess`类
	- `.spwan()`
- 衍生子进程实例的方法
	- `.fock()`
	- `.exec()`
	- `.spwan()`

## 底层类：`ChildProcess`

`ChildProcess`类继承了`EventEmitter`：

```JavaScript
function ChildProcess() {
  FunctionPrototypeCall(EventEmitter, this);
  // 与主进程连接状态
  this.connected = false;
  // 信号量
  this.signalCode = null;
  // 退出码
  this.exitCode = null;
  // 是否退出
  this.killed = false;
  // 可执行文件路径
  this.spawnfile = null;
  // 进程对象
  this._handle = new Process();
  this._handle[owner_symbol] = this;
  // 进程退出处理逻辑
  this._handle.onexit = (exitCode, signalCode) => {
    // ...
  };
}
ObjectSetPrototypeOf(ChildProcess.prototype, EventEmitter.prototype);
ObjectSetPrototypeOf(ChildProcess, EventEmitter);
```


## 衍生子进程：`ChildProcess.spwan()`


## 进程

## 线程
