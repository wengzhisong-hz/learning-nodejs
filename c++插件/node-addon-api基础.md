# `node-addon-api`基础

## 为什么使用`node-addon-api`

`node-api`是nodejs`8.x`版本推出的c++插件api。`node-addon-api`是对`node-api`的面向对象优化，完全依赖于`node-api`。下面我们来看看它们的不同：

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

### `node-addomp-api`示例

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

## 开发环境

### 安装

参考前文《实现c++插件的三种方式》，`node-addon-api`同样需要`node-gyp`、`make`、`c/c++`环境的支持。

```bash
npm install -g node-addon-api
```

### 脚手架工具

nodejs社区为我们提供了脚手架工具`generator-napi-module`，用于快速创建`node-addon-api`工程。

安装命令：

```bash
npm install -g yo
npm install -g generator-napi-module
```

创建工程：

```bash
yo napi-module # 创建简单的例子
或
yo napi-module --intermediate  # 创建生产中常见的工程模版
```

`generator-napi-module`支持ts，创建工程模版后目录结构如下：

```bash
├── binding.gy
├── lib
│   └── binding.ts
├── package.json
├── src
│   ├── basic_module.cc
│   └── basic_module.h
├── test
│   └── test_binding.js
└── tsconfig.json
```

然后在`package.json`的`script`中添加命令：

```json
"build": "node-gyp configure && node-gyp build"
```

由于ts和nodejs的版本更新比较快，建议进行锁版本操作：

```json
"devDependencies": {
  "@types/node": "7.0.22",
  "typescript": "2.3.3"
}
```

然后就可以进行插件的构建和调试了：

```bash
 npm install
 npm run build
 npm run test
```

输出信息：

```bash
> basic_module@1.0.0 test
> node --napi-modules ./test/test_binding.js

Hello kermit
I am mr-yeoman
Tests passed- everything looks OK!
```

## 插件中的函数

### 函数入参

插件函数接收类型为`Napi::CallbackInfo&`的参数：

```c++
Example::Example(Napi::CallbackInfo& info)
```

函数入参包含了：

- js调用插件时的参数对象
- 当调用发生时候的`env`对象

`Napi::CallbackInfo`主要用法如下：

```c++
Example::Example(Napi::CallbackInfo& info) {
   	// env
    Napi::Env env = info.Env();

    // js环境传入的构造函数参数长度
    size_t length = info.Length();

    // Napi::CallbackInfo 重载了 [] 操作符，能够以数组下标的形式访问js调用入参数
    bool isString = info[0].IsString();
}
```

### 环境变量 & 返回值

`Napi::Env`是对`node-api`中`napi_env`的封装。`napi_env`代表了nodejs调用插件时的环境变量（上下文）。

env数据由函数调用传入，即上面的`Napi::CallbackInfo`类型的入参；必须在函数的返回值中将env返回。

```c++
Napi::Value Example::fn(const Napi::CallbackInfo& info) {
  	// env从参数中获取
  	Napi::Env env = info.Env();
  
  	// 必须要返回env
		return Napi::String::New(env, "hello");
}
```

## 插件中的类

插件的类需要继承`Napi::ObjectWrap<T>`。

```c++
class Example : public Napi::ObjectWrap<Example> {};
```

## 数据类型

### 所有数据的基类：`NAPI::Value`

`Napi::Value`是插件中所有数据的基类。它是对`napi_value`和`napi_env`的封装，用于表示一个未知的js数据类型（相当黑盒）。

换句话说，你可以用`NAPI::Value`指定任何插件中的数据类型。

其用法如下：

- 指定返回值类型
- 获取env
- 将c++数据转换为`Napi::Value`
- 判断js数据类型
  - `IsArray`
  - `IsArrayBuffer`
  - `IsBoolean`
  - `IsBuffer`
  - `IsDataView`
  - `IsDate`
  - `IsEmpty`
  - `IsExternal`
  - `IsFunction`
  - `IsNull`
  - `IsObject`
  - `IsPromise`
  - `IsString`
  - `IsSymbol`
  - `IsTypedArray`
- 相等比较
  - `StrictEquals`
- 将一种`Napi::Value`转换为另一种`Napi::Value`类型
  - `ToNumber`
  - `ToObject`
  - `ToString`

示例如下：

```c++
// 指定返回值类型
Napi::Value BasicModule::fn(const CallbackInfo & info) {
Napi::Value BasicModule::fn(const CallbackInfo & info) {

    // 获取env
    Napi::Env env = info.Env();

    // 类型转换
    Napi::String arg = info[0].As<Napi::String>();

    // 将c++的数据转化为插件中的值，但是一般用子类的 New() 来转化
    Napi::Value new_str = Napi::Value::From(env, "a new string");

    // Is方法，用于判断数据类型，返回bool值
    bool is_string = info[0].IsString();

    // 相等比较
    bool equal = info[0].StrictEquals(info[1]);

    // To方法，用于转换当前的 Napi::Value 类型数据
    Napi::Number num = info[1].ToNumber();

    // Type操作，返回当前数据类型的枚举值，一般不用，用Is方法来替代这个功能
    napi_valuetype arg_type = info[0].Type();

    // 子类的 New 方法
    return Napi::String::New(env, "hello");
}
```

### 子类的`New()`方法

子类的`New()`方法用于创建包含env的新数据对象。它的第一个参数是`Napi::Env`类型的环境变量，第二个参数每个子类都有所不同，大家可以参考编辑器的提示，或者官方文档。

### 创建供js调用的c++函数

`Napi::Function`用于创建可以供js调用的c++方法。下面是一个简单的创建函数的例子：

```c++
Napi::Value fn_to_wappered(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return String::New(env, "hello");
}

Napi::Object init(Napi::Env env, Napi::Object exports) {
    exports.Set(String::New(env, "fn_wrapped"), Napi::Function::New(env, fn_to_wappered, "fn_wrapped"));
    return exports;
}

NODE_API_MODULE(NODE_GYP_MODULE_NAME, Init)
```

`cpp_fn`打包之后可以直接被js调用：

```js
const str = addon.fn_wrapped(); // "hello"
```

#### `Function::New`

`Function::New`接收2～4个参数：

```c++
static Function Function::New(
  														// env
  														 napi_env env,
  														// c++函数
                              Callable cb,
                              // 可选：函数名称
                              const char *utf8name = nullptr, 
                              // 可选：执行cb的时候，cb的入参
                              void *data = nullptr)
```

### 在c++中调用js函数



### 其它基础数据类型操作

> [文档](https://github.com/nodejs/node-addon-api)中有非常详细的说明，这里只做总结

- string
  - 生成utf-8格式的字符串
- number
  - int、float、double数据类型转换
- date
  - `ValueOf`返回时间戳
- object
  - `Set()`修改对象的值
  - `Delete()`删除对象的值
  - `Get()`获取对象的值
  - `Has()`判断对象是否包含值
  - `begin()`、`end()`对象的正向迭代器
    - `++`
    - `==`
    - `!=`
    - `*`
  - `[]`对象的随机迭代器
- array
  - 是object的子类
  - `Length()`返回数组长度

## 



























