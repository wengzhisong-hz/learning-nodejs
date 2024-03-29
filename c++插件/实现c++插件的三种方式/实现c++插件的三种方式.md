# 实现c++插件的三种方式

## 环境准备

编译插件我们会用到`node-gyp`，这是一个 nodejs 用于 c++插件跨平台编译的工具。`node-gyp`不是用来构建 nodejs 的。`node-gyp`支持编译多个 node 版本的插件，如：0.8, ... , 4, 5, 6, 等版本。

### 安装`node-gyp`

```bash
npm install -g node-gyp
```

如果 unix 环境，还需要：

-   Python (v3.7, v3.8, v3.9, 或 v3.10)
-   `make`
-   c/c++ 编译环境，如`gcc`

如果是 mac，则需要：

-   Python (v3.7, v3.8, v3.9, 或 v3.10)
-   `XCode Command Line Tools`（包含了`c/c++`和`make`）

### 设置 python 依赖

1.  通过命令行调用 node-gyp 的时候，指定 python 版本：

```bash
node-gyp <command> --python /path/to/executable/python
```

1.  通过 npm 调用 node-gyp，需要通过 npm 来配置 node-gyp 的 python 版本：

```bash
npm config set python /path/to/executable/python
```

1.  如果在`PATH`变量中有指定 python 版本的话，这个版本会作为默认 python 版本
2.  如果设置了`NODE_GYP_FORCE_PYTHON`，那么这个会覆盖以上的设置

## 编译 c++插件

### 配置`binding.gyp`

`binding.gyp`文件是`json-like`的格式，和`package.json`放在同一个目录层级中。基本的配置如下：

```json
{
  "targets": [
    {
      "target_name": "binding",
      "sources": ["src/binding.cc"]
    }
  ]
}
```

### 生成编译文件

进入到插件目录后：

```bash
node-gyp configure
```

`configure`指令会搜索当前目录下的`binding.gyp`。在 unix 下，会生成`Makefile`文件；在 windows 下，会生成`vcxproj`文件。

### 编译

然后执行：

```bash
node-gyp build

node-gyp build --target=v6.2.1 # 编译到指定node版本的插件
```

`build`命令会生成`.node`链接文件。可以在`build/Debug/`或者`build/Release/`中找到`.node`文件。

## 写一个 c++插件

### 原生：一次编写，到处修改

直接写一个 nodejs c++插件，会使用到以下库：

-   `v8`
-   `libuv`
-   nodejs 内置库：位于 nodejs 源码库`src/`中，常见的如`node::ObjectWrap`类
-   nodejs 包含的其他库，如`OpenSSL`

直接写的最大问题是这些库中的类和方法经常有变动。比如编写和编译的时候 nodejs 版本不同，那么编译很大可能会不通过，我们需要修改代码以匹配当前的 nodejs 版本，即`一次编写，到处修改`。

以一个简单的 log 为例，我们想要实现如下功能：

```javascript
module.exports = () => "hello";
```

为了有一个比较良好的编码环境（类型、错误提示等），我们可以先从 github 上下载一个 nodejs 源码仓库，然后在`src/`下创建一个`hello.cc`文件：

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
      "sources": ["hello.cc"]
    }
  ]
}
```

然后执行`node-gyp configure`和`node-gyp build`指令，得到`myAddon.node`文件。接下来验证一下：

```javascript
const MyAddon = require("./build/Release/myAddon.node");

console.log(MyAddon.hello()); // hello
```

### nan：一次编写，到处编译

nan（Native Abstractions for Node.js）可以将插件源码编译成为不同版本的 node 插件。nan 提供了一些稳定版本的宏定义来替代直接调用`v8`等库。即便是如此，`nan`仍然偏向 c++风格，而且同一个插件，如果换了 node 版本，就需要重新编译一次。

#### 安装和配置 nan

首先我们需要安装 nan：

```bash
npm install --save nan
```

这会在插件文件夹中创建一个 package.json 文件。

然后在`binding.gyp`中添加如下配置：

```json
"include_dirs" : [
    "<!(node -e \"require('nan')\")"
]
```

这可以使得插件的`.cpp /.cc`文件中可以使`#include <nan.h>`。

#### 插件代码

以 nan 方式实现 log：

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

安装 nan（`npm install --save nan`）：

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
      "sources": ["hello_nan.cc"],
      "include_dirs": ["<!(node -e \"require('nan')\")"]
    }
  ]
}
```

测试：

```javascript
const MyAddon = require("./build/Release/myAddon.node");

console.log(MyAddon.hello_nan()); // hello
```

### node-api：一次编写，到处使用

在 nodejs`8.x`之后，推出基于稳定的 ABI（Application Binary Interface）的 node-api。这种情况下，低版本的插件，也能够在高版本的 nodejs 环境中使用（nodejs 版本可以向上兼容，向下兼容仍需要写一些适配代码）。

node-api 是 c 风格的 api，社区为了便于使用，维护了一个名为`node-addon-api`的 c++风格的包。下面以`node-addon-api`为例，看看如何实现一个基于 node-api 的插件。

#### 安装和配置 node-addon-api

```bash
npm install --save node-addon-api
```

这会添加一个最新版本的 node-addon-api，当然也可以安装指定的版本。

然后在`binding.gyp`中添加如下配置：

```json
"include_dirs": [
  "<!(node -p \"require('node-addon-api').include_dir\")"
]
```

这可以让插件`.cc / .cpp`文件中可以使用`#include "napi.h"`。

然后可以添加开启 c++异常处理的配置：

```json
"conditions": [
  [
    "OS=='win'",
    {
      "defines": [
        "_HAS_EXCEPTIONS=1"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1
        }
      }
    }
  ],
  [
    "OS=='mac'",
    {
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.7"
      }
    }
  ]
]
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
      "sources": ["hello_node_api.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        [
          "OS=='win'",
          {
            "defines": ["_HAS_EXCEPTIONS=1"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.7"
            }
          }
        ]
      ]
    }
  ]
}
```

经过打包，我们可以验证一下：

```javascript
const MyAddon = require("./build/Release/myAddon.node");

console.log(MyAddon.hello_node_api()); // hello
```

## 为什么推荐使用`node-addon-api`

我们来看看`node-addon-api`和`node-api`的不同：

### `node-api`示例

```c++
#include <assert.h>
#include <node_api.h>

static napi_value Method(napi_env env, napi_callback_info info) {
  napi_status status;
  napi_value world;
  status = napi_create_string_utf8(env, "world", 5, &world);
  assert(status == napi_ok);
  return world;
}

#define DECLARE_NAPI_METHOD(name, func)                                        \
  { name, 0, func, 0, 0, 0, napi_default, 0 }

static napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_property_descriptor desc = DECLARE_NAPI_METHOD("hello", Method);
  status = napi_define_properties(env, exports, 1, &desc);
  assert(status == napi_ok);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

显然`node-api`是一个c风格的api，写起来略微繁琐。

### `node-addonp-api`示例

```c++
#include <napi.h>

Napi::String Method(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, "world");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "hello"),
              Napi::Function::New(env, Method));
  return exports;
}

NODE_API_MODULE(hello, Init)
```

相比之下，`node-addon-api`简洁了许多。由于`node-addon-api`也是由nodejs社区维护的，其稳定性是有保证的，将来也有可能会被合并到nodejs中。
