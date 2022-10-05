# buffer处理

`node-addon-api`提供了用于处理nodejs buffer的`Napi::Buffer`。在nodejs中，buffer模块继承了`Unit8Array`，类似地，`Napi::Buffer`继承了`Napi::Unit8Array`。

## c++创建buffer

### buffer分配

`Napi::Buffer::New`分配指大小为length的内存空间：

```c++
static Napi::Buffer<T> Napi::Buffer::New(napi_env env, size_t length);
```

注意，这里的buffer内存空间是由c++插件进行分配的，仅进行了分配操作，而没有初始化，类似于nodejs中的`buffer.allocUnsafe()`。我们看下例子：

```c++
#include <napi.h>

using namespace Napi;

Napi::Value allocateBuffer(const Napi::CallbackInfo& info) {
    int length = info[0].As<Napi::Number>();
    return Napi::Buffer<int>::New(info.Env(), length);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "allocateBuffer"),
                Napi::Function::New(env, allocateBuffer));
  return exports;
}

NODE_API_MODULE(addon, Init)
```

通过js调用上述插件：

```js
const addon = require('../build/Release/demo')

console.log(addon.allocateBuffer(10)) 
```

输出如下：

```bash
<Buffer 00 00 00 00 00 00 00 00 4e 00 ff 02 00 60 00 00 80 4a 80 7e f4 7f 00 00 01 00 00 00 00 00 00 00 88 42 c0 7e f4 7f 00 00>
```

### buffer分配并初始化

`Napi::Buffer::New`提供了一个重载来分配和初始化buffer：

```c++
static Napi::Buffer<T> Napi::Buffer::New(napi_env env, T* data, size_t length);
```

一个简单的例子：

```c++
#include <napi.h>

using namespace Napi;

Napi::Value newBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int length = info[0].As<Napi::Number>();
  	// New方法中的 T* data 目前来看只能支持 char* 和 int*
    char* str = "message from c++: hello nodejs";
    return Napi::Buffer<char>::New(env, str, length);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "newBuffer"),
            Napi::Function::New(env, newBuffer));

  return exports;
}
```

nodejs调用上述插件：

```js
const addon = require('../build/Release/demo')

const buf = addon.newBuffer(30)
console.log(buf.toString('utf-8')) // message from c++: hello nodejs
```

### `Napi::Buffer::Copy`

出了New方法，Buffer还提供了Copy方法来创建buffer：

```c++
static Napi::Buffer<T> Napi::Buffer::Copy(napi_env env, const T* data, size_t length);
```

## c++处理nodejs buffer

### `Napi::Buffer::Data`

通过Data方法来获取Buffer中的数据：

```c++
T* Napi::Buffer::Data() const;
```

### `Napi::Buffer::Length`

通过Length属性获取Buffer中的元素个数：

```c++
size_t Napi::Buffer::Length() const;
```

### 随机访问迭代器

buffer类可以通过`[]`等方法来访问其中的数据：

```c++
#include <napi.h>
#include <iostream>

void handleJsBuffer(const Napi::CallbackInfo& info) {
    Napi::Buffer<char> buf = info[0].As<Napi::Buffer<char>>();
    int length = buf.Length();
    for (int i = 0; i < length; i++) {
        std::cout << buf[i];
    }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "handleJsBuffer"),
                Napi::Function::New(env, handleJsBuffer));
  return exports;
}
```

在nodejs中向上面插件传入buffer：

```js
const addon = require('../build/Release/demo')

const buf = Buffer.from("buffer from nodejs: hello c++")
addon.handleJsBuffer(buf) // 输出：buffer from nodejs
```

## 