# 八、promise

# Promise

`Napi::Promise`继承了`Napi::Object`类。`Napi::Promise`和`Napi::Promise::Deferred`提供了创建、resolve、reject一个Promise对象的能力。

我们通过一个简单的例子来看看怎么使用：

```c++
#include <napi.h>
#include <iostream>
#include <chrono>

void async_resolve(Napi::Promise::Deferred deferred, Napi::Env env) {
    // 模拟异步，当然也可以用threadSafeFunction来执行deferred.Resolve
    std::this_thread::sleep_for(std::chrono::seconds(1));
    deferred.Resolve(Napi::String::New(env, "resolve message from c++"));
}

Napi::Value promiseFunction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    // 此处类似于 new promise 的同步过程
    std::cout << "c++同步代码..." << std::endl;

    // 异步标志
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    // 此处可以执行resolve或reject
    // 你可以通过线程安全函数来执行resolve或reject操作
    async_resolve(deferred, env);

    return deferred.Promise();
}   

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "promiseFunction"),
                Napi::Function::New(env, promiseFunction));
  return exports;
}

NODE_API_MODULE(addon, Init)
```

在js中：

```javascript
const addon = require('../build/Release/demo')

addon.promiseFunction().then(res => {
  console.log(res)
});
```

运行得到结果：

```bash
c++同步代码...

# 1s后
resolve message from c++
```
