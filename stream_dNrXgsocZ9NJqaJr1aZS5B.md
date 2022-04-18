# stream

## Wolai 目录

*   *   [核心API](#核心api)

    *   [什么是流](#什么是流)

        *   [可读流](#可读流)
        *   [可写流](#可写流)

    *   [EventEmitter](#eventemitter)

*   [深入理解可读流](#深入理解可读流)

    *   [可读流的状态Readable.\_readableState](#可读流的状态readable_readablestate)
    *   [手动读取数据Readable.read()](#手动读取数据readableread)
    *   [自动读取数据Readable.pipe()](#自动读取数据readablepipe)
    *   [底层向可读流提供数据readable.\_read()](#底层向可读流提供数据readable_read)
    *   [例：fs模块中实现\_read()方法](#例fs模块中实现_read方法)

*   [深入理解可写流](#深入理解可写流)

    *   *   [可写流的状态Writable.\_writableState](#可写流的状态writable_writablestate)
        *   [手动写入数据Writable.write()](#手动写入数据writablewrite)
        *   [底层消费可写流数据writable.\_wirte() 、writable.\_wirtev()](#底层消费可写流数据writable_wirte-writable_wirtev)
        *   [例：fs模块中实现\_write()、writable.\_wirtev()方法](#例fs模块中实现_writewritable_wirtev方法)

## 核心API

*   Stream类

    *   stream.Writable类

        *   `.pipe()`

        *   `.write()`

        *   `._write()`

        *   `.writableHighWaterMark`

    *   stream.Readable类

        *   `.read()`

        *   `._read()`

        *   `.readableHighWaterMark`

## 什么是流

在Node.js文档中这么介绍：

> 流是用于在 Node.js 中处理流数据的抽象接口。

更详细的说：

流是一个实现了观察者模式的类，继承了流的子类，用于处理大量buffer或js对象的读、写。

流的实现依赖于[events](events_gqCmhxVm2DHXK217Pw53xS.md "events")模块的EventEmitter。

### 可读流

继承了`stream.Readable`的可读流，需要实现`._read()`方法。

可读流通过`._read()`向可读流提供一个buffer（或js对象，下同，不再赘述），通过`.pipe()` 、`.read()` 来消费这个buffer。

### 可写流

继承了`stream.Writable`的可写流，需要实现`._wirte()`方法。

可写流通过`.write()`来向可写流提供一个buffer，通过`._write()`来消费buffer。

## EventEmitter

所有流都继承了EventEmitter类。

```javascript
// stream.js
const Stream = module.exports = require('internal/streams/legacy').Stream;
Stream.Readable = require('internal/streams/readable');
Stream.Writable = require('internal/streams/writable');
Stream.Duplex = require('internal/streams/duplex');
Stream.Transform = require('internal/streams/transform');

// internal/streams/legacy.js
onst EE = require('events');
// 继承了EventEmitter
function Stream(opts) {
  EE.call(this, opts);
}
ObjectSetPrototypeOf(Stream.prototype, EE.prototype);
ObjectSetPrototypeOf(Stream, EE);

```

# 深入理解可读流

## 可读流的状态Readable.\_readableState

在Readable类中，初始化了`._readableState`属性：

```javascript
function Readable(options) {
  // 可以通过 new Readable()实例化
  // 也可以通过直接调用Readable()实例化
  if (!(this instanceof Readable))
    return new Readable(options);

  // 经过上面的处理，下面属性和方法（比如._readableState），子类无法通过盗用构造函数的方式继承

  // 初始化 _readableState
  this._readableState = new ReadableState(options, this, isDuplex);

  // 继承Stream
  Stream.call(this, options);
}
```

`._readableState`中保存着许多重要的属性，如buffer、highWaterMark、length、流状态值。

```javascript

function ReadableState(options, stream, isDuplex) {
  
  this.highWaterMark = options ?
    getHighWaterMark(this, options, 'readableHighWaterMark', isDuplex) :
    getDefaultHighWaterMark(false);
  
  this.buffer = new BufferList();
  
  this.length = 0;
  
  this.pipes = [];
  
  this.flowing = null;
  
  // 及其它属性... 
  
}
```

任何Readable流，一定处于这三种状态之间：

*   `readable.readableFlowing === null`&#x20;

    *   初始化阶段

*   `readable.readableFlowing === false`

    *   消费流数据暂停

    *   向`._readableState.buffer`写入数据不一定暂停

*   `readable.readableFlowing === true`

    *   正在消费数据流

`readable.readableFlowing`指向了`._readableState.flowing`属性，其余Readable上的属性也和`_readableState`上的属性一一对应：

```javascript
ObjectDefineProperties(Readable.prototype, {

  // ...
  
  readableFlowing: {
    enumerable: false,
    get: function() {
      return this._readableState.flowing;
    },
    set: function(state) {
      if (this._readableState) {
        this._readableState.flowing = state;
      }
    }
  },
  
  // ...
  
})
```

## 手动读取数据Readable.read()

`.read()`会在可读流的流动模式下自动调用，直到将`._readableState.buffer`中的数据读取完毕。手动调用`.read()` 应该在流的暂停模式中调用。

```javascript
Readable.prototype.read = function(n) {

  let ret;
  
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (ret !== null && !state.errorEmitted && !state.closeEmitted) {
    state.dataEmitted = true;
    // 触发data事件，将buffer转移给消费者，但是注意，这里并没有将流的状态切换成流动模式。
    this.emit('data', ret);
  }
  // 返回数据块
  return ret;
};

function fromList(n, state) {
  let ret;
  if (state.objectMode)
    ret = state.buffer.shift();
  else if (!n || n >= state.length) {
    // 读取全部buffer
    ret = state.buffer.concat(state.length);
  } else {
    // 读取部分buffer
    ret = state.buffer.consume(n, state.decoder);
  }
  return ret;
}

```

## 自动读取数据Readable.pipe()

`.pipe()`方法接收一个可写流和配置项，并返回这个可写流。

```javascript
Readable.prototype.pipe = function(dest, pipeOpts) {
  const src = this;
  const state = this._readableState;
  
  src.on('data', ondata);
  function ondata(chunk) {
    // 当可读流将buffer提交给可写流的时候，调用可写流的write方法消费这个buffer
    const ret = dest.write(chunk);
    // 当可写流出错或者断开连接的时候，暂停可读流从内部buffer中读取数据
    if (ret === false) {
      pause();
    }
  }

  if (dest.writableNeedDrain === true) {
    if (state.flowing) {
      pause();
    }
  } else if (!state.flowing) {
    // 将可读流状态转为流动状态，可读流开始从内部buffer中读取数据
    src.resume();
  }
  
  // 返回可读流，支持链式调用
  return dest;
};
```

`pipe()`内部通过`resume()`方法来启动可读流，经过层层调用，`resume()`最终调用到`flow()`方法，在`flow()`方法内部实现了`Readable.read()`方法的自动调用：

```javascript
function flow(stream) {
  const state = stream._readableState;
  // 当流的状态为流动状态
  // 且read 方法能够读取到数据
  // 就持续性的调用read方法
  while (state.flowing && stream.read() !== null);
}

```

## 底层向可读流提供数据readable.\_read()

可读流子类需要实现`_read()`方法来向可读流提供数据：

```javascript
Readable.prototype._read = function(n) {
  // 如果子类没有实现_read方法则会报错
  throw new ERR_METHOD_NOT_IMPLEMENTED('_read()');
};
```

父类的`Readable.read()`方法除了消费`Readable._readableState.buffer`，也负责在每次消费buffer的时候，尝试通过`readable._read()`向`Readable._readableState.buffer`中添加buffer：

```javascript
Readable.prototype.read = function(n) {
  // 如果需要从底层读取数据
  let doRead = state.needReadable;

  // 如果_readableState.buffer的长度比highWaterMark小
  // 也需要从底层读取数据
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
  }
  // 但是，
  // 当流处于结束状态、错误、销毁、正在构造的状态
  // 或者已经正在从底层获取数据
  // 则不会触发从底层获取数据
  if (state.ended || state.reading || state.destroyed || state.errored ||
      !state.constructed) {
    doRead = false;
  } else if (doRead) {
    
    try {
      // 调用子类实现的_read()方法
      // 将highWaterMark作为参数，但是一次读取多少，还是由子类自行决定
      // 子类将在_read()方法中，将从底层获取的buffer写入到readable._readableState.buffer
      // 并且同时触发data事件
      const result = this._read(state.highWaterMark);
      
    } catch (err) {
      errorOrDestroy(this, err);
    }
  }
}
```

## 例：fs模块中实现\_read()方法

以`fs.ReadStream`类为例：

```javascript
ReadStream.prototype._read = function(n) {

  const buf = Buffer.allocUnsafeSlow(n);
  
  this[kFs]
    .read(this.fd, buf, 0, n, this.pos, (er, bytesRead, buf) => {
      
      if (er) {
        errorOrDestroy(this, er);
      } else if (bytesRead > 0) {
        if (this.pos !== undefined) {
          this.pos += bytesRead;
        }

        this.bytesRead += bytesRead;

        if (bytesRead !== buf.length) {
          
          const dst = Buffer.allocUnsafeSlow(bytesRead);
          buf.copy(dst, 0, 0, bytesRead);
          buf = dst;
        }
        // 在_read()方法中，最终调用了this.push()方法
        // 向._readableState.buffer中写入数据
        // 并触发data事件
        this.push(buf);
      } else {
        this.push(null);
      }
    });
};
```

在`ReadStream.prototype._read()`中调用了`this.push()`方法，这个方法定义在`Readable`上：

```javascript
Readable.prototype.push = function(chunk, encoding) {
  return readableAddChunk(this, chunk, encoding, false);
};
```

经过层层调用，最终调用到`addChunk`方法：

```javascript
function addChunk(stream, state, chunk, addToFront) {
  
  if (state.flowing && state.length === 0 && !state.sync &&
      stream.listenerCount('data') > 0) {
    // 触发data事件
    stream.emit('data', chunk);
  } else {
    // 或则更新buffer
    // 以及更新buffer的length
    state.length += state.objectMode ? 1 : chunk.length;
    if (addToFront)
      state.buffer.unshift(chunk);
    else
      state.buffer.push(chunk);

    if (state.needReadable)
      emitReadable(stream);
  }
  maybeReadMore(stream, state);
}
```

# 深入理解可写流

### 可写流的状态Writable.\_writableState

可写流同样具有一个全局状态`._writableState`：

```javascript
function Writable(options) {
  this._writableState = new WritableState(options, this, isDuplex);
  Stream.call(this, options); 
}

function WritableState(options, stream, isDuplex) {
  this.length = 0;
  // 初始化了内部的buffer状态
  resetBuffer(this);
}

function resetBuffer(state) {
  state.buffered = [];
  state.bufferedIndex = 0;
  state.allBuffers = true;
  state.allNoop = true;
}

```

### 手动写入数据Writable.write()

`.write()`方法用于向底层写入指定大小的数据块（通过调用`._wirte()`方法）：

```javascript
Writable.prototype.write = function(chunk, encoding, cb) {
  return _write(this, chunk, encoding, cb) === true;
};

function _write(stream, chunk, encoding, cb) {
  const state = stream._writableState;
  return writeOrBuffer(stream, state, chunk, encoding, cb);
}

function writeOrBuffer(stream, state, chunk, encoding, callback) {
  const len = state.objectMode ? 1 : chunk.length;

  state.length += len;
  const ret = state.length < state.highWaterMark;
  // 如果可写流中state.buffer的长度小于writableHighWaterMark的长度
  // 则可以触发'drain'事件
  if (!ret)
    state.needDrain = true;

  // 如果现在正在向state.buffer中写入数据
  // 或者处于错误、构造状态
  // 或者是批量小块数据处理完毕
  // 则将当前要写入state.buffer中的buffer推送到state.buffered队列中等待写入
  if (state.writing || state.corked || state.errored || !state.constructed) {
    state.buffered.push({ chunk, encoding, callback });
  } else {
    // 直接调用子类提供的_wirte方法，写入数据
    stream._write(chunk, encoding, state.onwrite);
  }
  return ret && !state.errored && !state.destroyed;
}
```

自动调用可写流的`.write()`方法，在深入理解可读流部分，我们已经解析过了，可写流作为参数传入可读流的`.pipe()`方法，并在`.pipe()`方法内部进行调用，从而实现自动写入数据。

### 底层消费可写流数据writable.\_wirte() 、writable.\_wirtev()

上面提到在`Writable.write()`方法中会调用子类实现的`writable._wirte()`、`writable._wirtev()`方法。

```javascript
Writable.prototype._write = function(chunk, encoding, cb) {
  if (this._writev) {
    this._writev([{ chunk, encoding }], cb);
  } else {
    throw new ERR_METHOD_NOT_IMPLEMENTED('_write()');
  }
};
```

### 例：fs模块中实现\_write()、writable.\_wirtev()方法

在fs模块中，分别实现了`_write()`方法和`_writev()`方法来消费可写流数据:

```javascript
const fs = require('fs');
const kFs = Symbol('kFs');

function ReadStream(path, options) {

  this[kFs] = options.fs || fs;
  
}

WriteStream.prototype._write = function(data, encoding, cb) {
  
  // 调用了fs.write方法，将字符串数据写入到指定目标中
  this[kFs].write(this.fd, data, 0, data.length, this.pos, (er, bytes) => {
    
    cb();
    
  });
};

WriteStream.prototype._writev = function(data, cb) {
  const len = data.length;
  const chunks = new Array(len);
  let size = 0;
  for (let i = 0; i < len; i++) {
    const chunk = data[i].chunk;
    chunks[i] = chunk;
    size += chunk.length;
  }

  // 调用了fs.writev方法，将buffer数据写入到指定目标中
  this[kFs].writev(this.fd, chunks, this.pos, (er, bytes) => {
    
    cb();
  });
};
```
