# buffer

## node & js 中 buffer 的区别

> `ArrayBuffer`对象代表原始的二进制数据 `TypedArray`视图用来读写简单类型的二进制数据（ArrayBuffer），`DataView`视图用来读写复杂类型的二进制数据(ArrayBuffer)。 Node 中的`Buffer`类是以更优化和更适合 Nodejs 的方式实现了`Uint8Array` API，意思就是`Buffer`类其实是`TypedArray(Uint8Array)`的 nodejs 实现。

## buffer & cache

buffer 的目的是起到流量整形的作用，减少短期内突发 I/O 的影响。

cache 是处理系统两端处理速度不匹配的情况，比如磁盘、内存、cpu 处理速度不一样，所以会有各种缓存技术。cache 中的数据是可以重复获取的。

## 创建 buffer

1. Blob 类
   1. Blob 封装了不可变数据，可以在多个工作线程中安全地共享，v15 新增
   2. 使用 `new buffer.Blob(source, opts)` 创建
2. Buffer 类
   1. `alloc(size, fill = 0, encoding = 'utf8')`
   2. `allocUnsafe(size)`
   3. `allocUnsafeSlow(size)`
   4. `from()`
      1. array、arrayBuffer、buffer、object、string
3. 字符编码默认使用`utf8`
   1. 支持`utf8 utf16le latin1 base64 base64url hex ascii latin1 binary`
4. 使用 `for...of` 遍历 buffer

### 中文乱码问题

中文字符在`utf8`中占 3 个字节。

需要设置 stream 的编码方式为`utf8`。通过`setEncoding` 设置的 buffer，在被处理的时候已经转为中文字符串了。

## buffer 内存分配原理

node 采用 slab 机制进行内存分配。

### Buddy

> 内存从一个 2 的 N 次幂大的内存块中分配。当内存块比要分配的长度大两倍以上，内存块平均分裂成两块。选中其中一半，重复这个过程（检查长度，满足条件则分裂）直到内存块刚好等于需要的长度。
>
> 所有的块信息保存在一个排序过的链表或者二叉树中。当一个块被释放的时候与他的相邻块进行比较。如果他们都被释放，就合并成一个大块放进更大的一个块列表 中。每当分配结束，分配器会从尽量小的块重新开始分配，以避免产生不必要的碎片。

### Slab

专注于小内存分配。与 buddy 互相配合。

1. 状态
   1. full
   2. partial
   3. empty
2. 体积限制
   1. `Buffer.poolSize = 8*1024`

**buffer 分配内存总结：**

1. 在初次加载时就会初始化 1 个 **8KB 的内存空间**
2. 根据申请的内存大小分为 **小 Buffer 对象** 和 **大 Buffer 对象**
   1. 大于 buffer.poolSize / 2，为大 buffer 对象，小于则为小 buffer 对象
3. 小 Buffer 情况，会继续判断这个 slab 空间是否足够
   - 如果空间足够就去使用剩余空间同时更新 slab 分配状态，偏移量会增加
   - 如果空间不足，slab 空间不足，就会去创建一个新的 slab 空间用来分配
4. 大 Buffer 情况，则会直接走 createUnsafeBuffer(size) 函数
5. 不论是小 Buffer 对象还是大 Buffer 对象，内存分配是在 C++ 层面完成，内存管理在 JavaScript 层面，最终还是可以被 V8 的垃圾回收标记所回收。
