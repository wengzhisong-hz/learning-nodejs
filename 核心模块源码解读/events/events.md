# events

Node.js中大多数的模块都依赖于events模块。比如buffer、stream、http、fs。我们在koa等框架中也能看见events的身影。

## 核心API

- EventEmitter类
	- on()
	- once()
	- emit()
	- removeListener()
	- addListener()

## 调用方式

当使用emit触发事件的时候，所有绑定到该事件的回调函数会被同步调用，忽略回调函数的返回值。

```JavaScript
const { EventEmitter } = require("events");

const emitter = new EventEmitter();
emitter.on("event", () => {
  console.log(1);
});
emitter.emit("event");
console.log(2);

// 1
// 2
```


## 捕捉错误

如果 `EventEmitter` 没有为 `'error'` 事件注册至少一个监听器，并且触发 `'error'` 事件，则会抛出错误，打印堆栈跟踪，然后退出 Node.js 进程。作为最佳实践，应始终为`'error'`事件添加监听器。

















































