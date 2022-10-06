# 使用worker线程

## `AsyncWorker`

c++插件通常需要长时间的执行一些任务，为了不阻塞nodejs的evenloop，需要异步地执行这些任务。nodejs的主线程是js的执行线程，在实际应用中，我们应该避免在主线程上阻塞任务队列中的其他任务。因此，可以在另外一个线程中执行这些占用高的插件任务。

在另外一个线程中执行插件任务需要借用到libuv的调度能力（libuv中管理着一个线程池，其中包括了nodjs主线程）。

node-addon-api提供了`Napi::AsyncWorker`来在eventloop中调度worker threads。

下面我们来看一个简单的例子，这是一个异步输出的类：

```c++
#include <napi.h>
#include <chrono>
#include <thread>

#include <iostream>

using namespace Napi;

class EchoWorker: public AsyncWorker {
public:
    EchoWorker(Function& callback, std::string& echo): AsyncWorker(callback), echo(echo) {}
		// 需要覆写基类的Execute，该方法会在eventloop之外，通过libuv再起一个worker线程来执行任务
    void Execute() override {
        std::cout << "start in worker thread" << std::endl;
        // 模拟长耗时任务
        std::this_thread::sleep_for(std::chrono::seconds(3));
        std::cout << "after 3 sec, quit worker thread" << std::endl;
    }
		// 该方法会在Execute方法执行之后被调用
    void OnOK() override {
        HandleScope scope(Env());
        // AsyncWorker::Callback中存储了js传入的callback
        Callback().Call({Env().Null(), Napi::String::New(Env(), echo)});
    }
private:
    std::string echo;
};
```

我们在插件中使用这个异步输出的类：

```c++
#include <napi.h>
#include <iostream>

#include "./async_worker.cpp"

Napi::Value asyncEcho(const Napi::CallbackInfo& info) {
    std::string msg = info[0].As<Napi::String>();
    Napi::Function cb = info[1].As<Napi::Function>();

    EchoWorker* worker = new EchoWorker(cb, msg);
    // 在任务队列中添加这个worker的执行任务，这些worker任务会被按次序执行
    worker->Queue();
    return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "asyncEcho"),
                Napi::Function::New(env, asyncEcho));
  return exports;
}
```

我们在nodejs环境中测试这个异步输出插件：

```js
const addon = require('../build/Release/demo')

function cb(err, msg) {
  if (err) {
    console.log("error occurs in async worker: ", err)
  } else {
    console.log("message async echo: ", msg)
  }
}
addon.asyncEcho("hello", cb);
```

测试结果如下：

```bash
start in worker thread
after 3 sec, quit worker thread
message async echo:  hello
```

## `AsyncWorker`类的主要方法

### `Constructor`

一般来说，会用到包含callback的重载：

```c++
explicit Napi::AsyncWorker(const Napi::Function& callback);
```

### `Queue`

按照队列的形式执行worker：

```c++
void Napi::AsyncWorker::Queue();
```

### `Callback`

`Callback`中引用了传入的js callback，可以在`OnOK`或者`OnError`中直接使用`Callback`。c++给js函数返回的第一个参数是error。

```c++
Napi::FunctionReference& Napi::AsyncWorker::Callback();

// 例如：
void OnOK() override {
  // AsyncWorker::Callback中存储了js传入的callback
  Callback().Call({Env().Null(), Napi::String::New(Env(), echo)});
}
```

### `Execute`

在`Execute`中的任务是在eventloop之外，在libuv创建的worker线程中执行。子类必须要实现这个`AsyncWorker`的虚函数。

```c++
virtual void Napi::AsyncWorker::Execute() = 0;
```

### `OnOK、OnError`

onError由`Execute`中的`Napi::AsyncWorker::SetError`触发：

```c++
virtual void Napi::AsyncWorker::OnOK();
virtual void Napi::AsyncWorker::OnError(const Napi::Error& e);
```

## 