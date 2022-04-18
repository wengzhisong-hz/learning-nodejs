# events

## Wolai 目录

*   [核心API](#核心api)
*   [调用方式](#调用方式)
*   [捕捉错误](#捕捉错误)
*   [on()](#on)
*   [emit()](#emit)
*   [once()](#once)

## 核心API

*   EventEmitter类

    *   `on()`

    *   `once()`

    *   `emit()`

    *   `removeListener()`

    *   `addListener()`

## 调用方式

当使用emit触发事件的时候，所有绑定到该事件的回调函数会被同步调用，忽略回调函数的返回值。

```javascript
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

## on()

`on()`方法是`addListener()`的alias:

```javascript
EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;

EventEmitter.prototype.on = EventEmitter.prototype.addListener;
```

最终实现依赖于`_addListener()`方法。不同类型的事件和回调，会被储存到原型链上的`_events`属性上：

```javascript
EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

function _addListener(target, type, listener, prepend) {
  let m;
  let events;
  let existing;

  checkListener(listener);
  // 获取储存在原型链上的事件
  // 也就是变相的实现了单例
  events = target._events;
  // 初始化
  if (events === undefined) {
    events = target._events = ObjectCreate(null);
    target._eventsCount = 0;
  } else {
    // 尝试查询这个类型的事件是否已经注册
    existing = events[type];
  }

  if (existing === undefined) {
    // 如果这个类型的事件没有注册过
    // 那么将这个类型的事件注册到events中
    events[type] = listener;
    ++target._eventsCount;
  } else {
    // 如果这种类型的事件已经注册过
    
    // 那么将新的listener添加到数组中
    // 如果existing（也就是listener）不是数组则要先转化为数组
    if (typeof existing === 'function') {
      existing = events[type] =
        prepend ? [listener, existing] : [existing, listener];
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // 检查监听者数量是否超过了预设值
    m = _getMaxListeners(target);
    if (m > 0 && existing.length > m && !existing.warned) {
      existing.warned = true;
      const w = new Error('Possible EventEmitter memory leak detected. ' +
                          `${existing.length} ${String(type)} listeners ` +
                          `added to ${inspect(target, { depth: -1 })}. Use ` +
                          'emitter.setMaxListeners() to increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.emitter = target;
      w.type = type;
      w.count = existing.length;
      process.emitWarning(w);
    }
  }
  // 返回this
  return target;
}
```

## emit()

`emit()`方法会从`_events`中获取到事件对应的handle，并同步地执行这些handle：

```javascript
EventEmitter.prototype.emit = function emit(type, ...args) {
  const events = this._events;
  // 获取handle
  const handler = events[type];
  
  if (handler === undefined)
    return false;

  if (typeof handler === 'function') {
    // 如果只有一个监听者则直接执行
    const result = handler.apply(this, args);

  } else {
    const len = handler.length;
    // 如果有多个监听者
    // 则同步的、按照注册顺序调用这些handle
    const listeners = arrayClone(handler);
    for (let i = 0; i < len; ++i) {
      const result = listeners[i].apply(this, args);
    }
  }
  return true;
};

```

## once()

`once()`会注册一个被`_onceWrap()`包装过后的handle。

```javascript
EventEmitter.prototype.once = function once(type, listener) {
  checkListener(listener);

  this.on(type, _onceWrap(this, type, listener));
  return this;
};
```

调用`_onceWrap()`包装过的handle 函数，会先从`_events`中移除这个监听者，并执行实际的handle：

```javascript
function _onceWrap(target, type, listener) {
  // handle执行环境
  const state = { fired: false, wrapFn: undefined, target, type, listener };
  // 返回一个包装函数
  const wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

function onceWrapper() {
  // 如果尚未执行这个handle
  if (!this.fired) {
    // 从_events中移除这个监听者
    this.target.removeListener(this.type, this.wrapFn);
    // 已经执行标志位置为true
    this.fired = true;
    // 调用handle
    if (arguments.length === 0)
      return this.listener.call(this.target);
    return this.listener.apply(this.target, arguments);
  }
}

```
