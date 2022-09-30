# c++插件入门

## 加载c++插件

nodejs c++插件是用c++编写的动态链接库。

nodejs通过`require()`函数将插件加载为普通的nodejs模块：

```js
// Native extension for .node
Module._extensions['.node'] = function(module, filename) {
  if (policy?.manifest) {
    const content = fs.readFileSync(filename);
    const moduleURL = pathToFileURL(filename);
    policy.manifest.assertIntegrity(moduleURL, content);
  }
  // Be aware this doesn't use `content`
  return process.dlopen(module, path.toNamespacedPath(filename));
};
```

而`process.dlopen`则是nodejs的bootstrap阶段初始化的：

```js
const rawMethods = internalBinding('process_methods');

{
  process.dlopen = rawMethods.dlopen;
  
  // 初始化其他方法...
}
```

在`InitializeProcessMethods`方法中，将`binding::DLOpen`绑定到了process的`dlopen`方法上:

```c++
static void InitializeProcessMethods(Local<Object> target,
                                     Local<Value> unused,
                                     Local<Context> context,
                                     void* priv) {
  Environment* env = Environment::GetCurrent(context);
  
  env->SetMethod(target, "dlopen", binding::DLOpen);
}
```

最后，我们可以在`node_binding.cc`通过`DLOpen`看到nodejs是如何加载c++插件的：



```c++
void DLOpen(const FunctionCallbackInfo<Value>& args) {
  
  // FunctionCallbackInfo<> 用于描述callback的上下文信息
  // .node模块作为参数传入DLOpen
  
  Environment* env = Environment::GetCurrent(args);
  auto context = env->context();

  Local<Object> module;
  Local<Object> exports;
  Local<Value> exports_v;
  
  if (
      // ToObject 用于生成js url对象
    	// 此处生成了名为 module 的 js url
      !args[0]->ToObject(context).ToLocal(&module) ||
      
      // 生成module的exports
      !module->Get(context, env->exports_string()).ToLocal(&exports_v) ||
    
      !exports_v->ToObject(context).ToLocal(&exports)) {
    return;
  }

  node::Utf8Value filename(env->isolate(), args[1]);
  
  // 加载插件
  // DLib 类通过libuv的uv_dlopen方法加载动态链接库
  env->TryLoadAddon(*filename, flags, [&](DLib* dlib) {
    static Mutex dlib_load_mutex;
    Mutex::ScopedLock lock(dlib_load_mutex);
		
    
    // 此处调用了最终 uv_dlopen()加载链接库
    // 加载结果会存储到 dlib->handle_中
    const bool is_opened = dlib->Open();

    // 从当前线程获取待处理的插件信息
    // mp为node_module类型
    // node_module 如下：
    //    struct node_module {
    //      int nm_version;
    //      unsigned int nm_flags;
    //      void* nm_dso_handle;
    //      const char* nm_filename;
    //      node::addon_register_func nm_register_func;
    //      node::addon_context_register_func nm_context_register_func;
    //      const char* nm_modname;
    //      void* nm_priv;
    //      struct node_module* nm_link;
    //    };
    node_module* mp = thread_local_modpending;
    thread_local_modpending = nullptr;

    

    if (mp != nullptr) {
      mp->nm_dso_handle = dlib->handle_;
      // 将mp存储到全局模块的map中
      dlib->SaveInGlobalHandleMap(mp);
    }

		// napi方式注册的插件
    if ((mp->nm_version != -1) && (mp->nm_version != NODE_MODULE_VERSION)) {
      
      if (auto callback = GetInitializerCallback(dlib)) {
        callback(exports, module, context);
        return true;
      }
    }

    Mutex::ScopedUnlock unlock(lock);
    if (mp->nm_context_register_func != nullptr) {
      // 注册插件
      mp->nm_context_register_func(exports, module, context, mp->nm_priv);
    } else if (mp->nm_register_func != nullptr) {
      mp->nm_register_func(exports, module, mp->nm_priv);
    } else {
      dlib->Close();
      THROW_ERR_DLOPEN_FAILED(env, "Module has no declared entry point.");
      return false;
    }

    return true;
  });
}
```

## 环境准备

编译插件我们会用到`node-gyp`，这是一个nodejs用于c++插件跨平台编译的工具。`node-gyp`不是用来构建nodejs的。`node-gyp`支持编译多个node版本的插件，如：0.8, ... , 4, 5, 6, 等版本。

### 安装`node-gyp`

```bash
npm install -g node-gyp
```

如果unix环境，还需要：

- Python (v3.7, v3.8, v3.9, 或v3.10)
- `make`
- c/c++ 编译环境，如`gcc`

如果是mac，则需要：

- Python (v3.7, v3.8, v3.9, 或v3.10)
- `XCode Command Line Tools`（包含了`c/c++`和`make`）

### 设置python依赖

1. 通过命令行调用node-gyp的时候，指定python版本：

```bash
node-gyp <command> --python /path/to/executable/python
```

2. 通过npm调用node-gyp，需要通过npm来配置node-gyp的python版本：

```bash
npm config set python /path/to/executable/python
```

3. 如果在`PATH`变量中有指定python版本的话，这个版本会作为默认python版本
4. 如果设置了`NODE_GYP_FORCE_PYTHON`，那么这个会覆盖以上的设置

## 编译c++插件

### 配置`binding.byp`

`binding.gyp`文件是`json-like`的格式，和`package.json`放在同一个目录层级中。基本的配置如下：

```json
{
  "targets": [
    {
      "target_name": "binding",
      "sources": [ "src/binding.cc" ]
    }
  ]
}
```

### 生成编译文件

进入到插件目录后：

```bash
node-gyp configure
```

`configure`指令会搜索当前目录下的`binding.gyp`。在unix下，会生成`Makefile`文件；在windows下，会生成`vcxproj`文件。

### 编译

然后执行：

```bash
node-gyp build

node-gyp build --target=v6.2.1 # 编译到指定node版本的插件
```

`build`命令会生成`.node`链接文件。可以在`build/Debug/`或者`build/Release/`中找到`.node`文件。

## 写一个c++插件

### 原生：一次编写，到处修改

直接写一个nodejs c++插件，会使用到以下库：

- `v8`
- `libuv`
- nodejs 内置库：位于nodejs源码库`src/`中，常见的如`node::ObjectWrap`类
- nodejs包含的其他库，如`OpenSSL`

直接写的最大问题是这些库中的类和方法经常有变动。比如编写和编译的时候nodejs版本不同，那么编译很大可能会不通过，我们需要修改代码以匹配当前的nodejs版本，即`一次编写，到处修改`。

以一个简单的log为例，我们想要实现如下功能：

```js
module.exports = () => 'hello'
```

为了有一个比较良好的编码环境（类型、错误提示等），我们可以先从github上下载一个nodejs源码仓库，然后在`src/`下创建一个`hello.cc`文件：

```c++
#include <node.h>

namespace MyAddon
{
  // 此处直接使用了v8内部的模版和类型
  // 如果将来这些模版和类型有变动的话
  // 插件将无法通过编译
  using v8::FunctionCallbackInfo;
  using v8::Isolate;
  using v8::Local;
  using v8::Object;
  using v8::String;
  using v8::Value;

  void method(const FunctionCallbackInfo<Value> &args)
  {
    Isolate *isolate = args.GetIsolate();
    // 返回一个 hello 字符串
    args.GetReturnValue().Set(
        String::NewFromUtf8(isolate, "hello").ToLocalChecked());
  }

  void initialize(Local<Object> exports)
  {
    // 将方法挂载在exports上
    NODE_SET_METHOD(exports, "hello", method);
  }
	// 通过NODE_MODULE宏进行模块注册
  NODE_MODULE(NODE_GYP_MODULE_NAME, initialize);
} // namespace MyAddon
```

将编写好的`hello.cc`文件拷贝出来，然后在同一个目录下创建`binding.gyp`文件：

```json
{
  "targets": [
    {
      "target_name": "myAddon",
      "sources": [ "hello.cc" ]
    }
  ]
}
```

然后执行`node-gyp configure`和`node-gyp build`指令，得到`myAddon.node`文件。接下来验证一下：

```js
const MyAddon = require("./build/Release/myAddon.node");

console.log(MyAddon.hello()); // hello
```

### nan：一次编写，到处编译

nan（Native Abstractions for Node.js）可以将插件源码编译成为不同版本的node插件。nan提供了一些稳定版本的宏定义来替代直接调用`v8`等库。即便是如此，`nan`仍然偏向c++风格，而且同一个插件，如果换了node版本，就需要重新编译一次。

#### 安装和配置nan

首先我们需要安装nan：

```bash
npm install --save nan
```

这会在插件文件夹中创建一个package.json文件。

然后在`binding.gyp`中添加如下配置：

```json
"include_dirs" : [
    "<!(node -e \"require('nan')\")"
]
```

这可以使得插件的`.cpp /.cc`文件中可以使`#include <nan.h>`。

#### 插件代码

以nan方式实现log：

```c++
// hello_nan.cc
#include <nan.h>

void Method(const Nan::FunctionCallbackInfo<v8::Value> &info)
{
  info.GetReturnValue().Set(Nan::New("hello").ToLocalChecked());
}

void Init(v8::Local<v8::Object> exports)
{
  v8::Local<v8::Context> context = exports->CreationContext();
  exports->Set(context,
               Nan::New("hello_nan").ToLocalChecked(),
               Nan::New<v8::FunctionTemplate>(Method)
                   ->GetFunction(context)
                   .ToLocalChecked());
}

NODE_MODULE(hello, Init)
```

安装nan（`npm install --save nan`）：

```json
// package.json
{
  "dependencies": {
    "nan": "^2.16.0"
  }
}
```

配置文件：

```json
{
  "targets": [
    {
      "target_name": "myAddon",
      "sources": [ "hello_nan.cc" ],
      "include_dirs" : [
        "<!(node -e \"require('nan')\")"
      ]
    }
  ]
}
```

测试：

```js
const MyAddon = require("./build/Release/myAddon.node");

console.log(MyAddon.hello_nan()); // hello
```

### node-api：一次编写，到处使用

在nodejs`8.x`之后，推出基于稳定的ABI（Application Binary Interface）的node-api。这种情况下，低版本的插件，也能够在高版本的nodejs环境中使用（nodejs版本可以向上兼容，向下兼容仍需要写一些适配代码）。



node-api是c风格的api，社区为了便于使用，维护了一个名为`node-addon-api`的c++风格的包。下面以`node-addon-api`为例，看看如何实现一个基于node-api的插件。



#### 安装和配置node-addon-api

```bash
npm install --save node-addon-api
```

这会添加一个最新版本的node-addon-api，当然也可以安装指定的版本。

然后在`binding.gyp`中添加如下配置：

```json
"include_dirs": [
  "<!(node -p \"require('node-addon-api').include_dir\")"
]
```

这可以让插件`.cc / .cpp`文件中可以使用`#include "napi.h"`。

然后可以添加开启c++异常处理的配置：

```json
'cflags!': [ '-fno-exceptions' ],
'cflags_cc!': [ '-fno-exceptions' ],
'conditions': [
  ["OS=='win'", {
    "defines": [
      "_HAS_EXCEPTIONS=1"
    ],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "ExceptionHandling": 1
      },
    },
  }],
  ["OS=='mac'", {
    'xcode_settings': {
      'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
      'CLANG_CXX_LIBRARY': 'libc++',
      'MACOSX_DEPLOYMENT_TARGET': '10.7',
    },
  }],
],
```

或者可以禁用它：

```json
'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
```

#### 插件代码

`hello_node_api.cc`:

```c++
#include <napi.h>

Napi::String Method(const Napi::CallbackInfo &info)
{
  Napi::Env env = info.Env();
  return Napi::String::New(env, "hello");
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
  exports.Set(Napi::String::New(env, "hello_node_api"),
              Napi::Function::New(env, Method));
  return exports;
}

NODE_API_MODULE(hello, Init)
```

`package.json`（`npm install --save node-addon-api`）

```json
{
  "dependencies": {
    "node-addon-api": "^5.0.0"
  }
}
```

`binding.gyp`：

```json
{
  "targets": [
    {
      "target_name": "myAddon",
      "sources": [ "hello_node_api.cc" ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      'cflags!': [ '-fno-exceptions' ],
      'cflags_cc!': [ '-fno-exceptions' ],
      'conditions': [
        ["OS=='win'", {
          "defines": [
            "_HAS_EXCEPTIONS=1"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            },
          },
        }],
        ["OS=='mac'", {
          'xcode_settings': {
            'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
            'CLANG_CXX_LIBRARY': 'libc++',
            'MACOSX_DEPLOYMENT_TARGET': '10.7',
          },
        }],
      ]
    }
  ]
}
```

经过打包，我们可以验证一下：

```js
const MyAddon = require("./build/Release/myAddon.node");

console.log(MyAddon.hello_node_api()); // hello
```





















