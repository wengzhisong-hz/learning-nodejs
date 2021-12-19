# Buffer

## 核心API

- Buffer类
	- alloc()
	- allocUnsafe()
	- concat()
	- from()
	- poolSize
	- fill()

## 与ArrayBuffer的区别

> `ArrayBuffer`对象作为内存区域，可以存放多种类型的数据。同一段内存，不同数据有不同的解读方式，这就叫做“视图”（view）。`ArrayBuffer`有两种视图，一种是`TypedArray`视图，另一种是`DataView`视图。前者的数组成员都是同一个数据类型，后者的数组成员可以是不同的数据类型。


> 目前，`TypedArray`视图一共包括 9 种类型，每一种视图都是一种构造函数：`Int8Array、Uint8Array、Uint8ClampedArray、Int16Array、Uint16Array、Int32Array、Uint32Array、Float32Array、Float64Array` 。


从Node的代码来看，`Buffer` 继承自 `Uint8Array`:

```JavaScript
// internal/buffer.js

class FastBuffer extends Uint8Array {
  // Using an explicit constructor here is necessary to avoid relying on
  // `Array.prototype[Symbol.iterator]`, which can be mutated by users.
  // eslint-disable-next-line no-useless-constructor
  constructor(bufferOrLength, byteOffset, length) {
    super(bufferOrLength, byteOffset, length);
  }
}

// buffer.js

Buffer.prototype = FastBuffer.prototype;
```


## 与cache的区别

> cache 是为了弥补高速设备和低速设备的鸿沟而引入的中间层，最终起到**加快访问速度** 的作用。


> 而 buffer 的主要目的进行流量整形，把突发的大数量较小规模的 I/O 整理成平稳的小数量较大规模的 I/O，以**减少响应次数** 


## 内存分配

> Buffer的内存不是由V8 分配，而是在Node的C++ 层面完成申请，在JavaScript中进行内存分配。这部分内存成为**堆外内存** ，最终被V8 的垃圾回收标记所回收。


Node.js 采用了 slab 机制进行**预先申请、事后分配** ，是一种动态的管理机制。

### 主要过程

#### **初始化8kb内存空间** ：

```JavaScript
Buffer.poolSize = 8 * 1024;

let poolSize, poolOffset, allocPool;

function createPool() {
  poolSize = Buffer.poolSize;
  // 通过 createUnsafeBuffer 初始化一个8kb的内存空间
  allocPool = createUnsafeBuffer(poolSize).buffer;
  markAsUntransferable(allocPool);
  // 偏移量初始化
  poolOffset = 0;
}
createPool();
```


`createUnsafeBuffer` 方法返回一个`FastBuffer` :

```JavaScript
function createUnsafeBuffer(size) {
  zeroFill[0] = 0;
  try {
    return new FastBuffer(size);
  } finally {
    zeroFill[0] = 1;
  }
}
```


#### **alloc()** **无论buffer大小，直接创建一个FastBuffer：** 

```JavaScript
Buffer.alloc = function alloc(size, fill, encoding) {
  assertSize(size);
  if (fill !== undefined && fill !== 0 && size > 0) {
    // 创建一个FastBuffer
    const buf = createUnsafeBuffer(size);
    // 初始化这个FastBuffer,默认为utf-8,用0填充
    return _fill(buf, fill, 0, buf.length, encoding);
  }
  return new FastBuffer(size);
};

```


#### `allocUnsafe()`**会根据size大小走不同的分配方式：** 

```JavaScript
Buffer.allocUnsafe = function allocUnsafe(size) {
  assertSize(size);
  return allocate(size);
};

function allocate(size) {
  if (size <= 0) {
    return new FastBuffer();
  }
  // 当size小于poolSize的1/2会进行slab内存分配
  if (size < (Buffer.poolSize >>> 1)) {
    // 如果当前的slab空间不够，会创建一个新的slab
    if (size > (poolSize - poolOffset))
      createPool();
    // 在slab（也就是这个allocPool）中返回从偏移量等于poolOffset，长度等于size的buffer。
    // 这个FastBuffer指向的内存区域在slab中。
    const b = new FastBuffer(allocPool, poolOffset, size);
    // 重新设定偏移量
    poolOffset += size;
    // 8kb对齐
    alignPool();
    return b;
  }
  // 当size大于poolSize的1/2，直接分配
  return createUnsafeBuffer(size);
}

```


### slab分配策略的好处

主要好处有两点：

1. 不会因为碎片储存浪费内存
2. 可以快速分配内存（在当前slab空间够用的情况下）



