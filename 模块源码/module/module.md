# module

## 核心 API

-   `module.exports`
-   `require()`

## Module 类

Node.js 现在支持 cjs 与 esm。

```javascript
const moduleParentCache = new SafeWeakMap();

function Module(id = '', parent) {
  this.id = id;
  // 获取模块所在的目录
  this.path = path.dirname(id);
  // 模块导出
  this.exports = {};
  // 将此Module缓存到父节点
  moduleParentCache.set(this, parent);
  // 更新子节点缓存
  updateChildren(parent, this, false);
  this.filename = null;
  // 加载状态
  this.loaded = false;
  this.children = [];
}
// 初始化node内置模块
const builtinModules = [];
for (const { 0: id, 1: mod } of NativeModule.map) {
  if (mod.canBeRequiredByUsers) {
    ArrayPrototypePush(builtinModules, id);
  }
}
// 防止用户修改内置模块
ObjectFreeze(builtinModules);
Module.builtinModules = builtinModules;
// 模块缓存
Module._cache = ObjectCreate(null);
// 模块路径缓存
Module._pathCache = ObjectCreate(null);
// .js .json .node类型的模块加载器
Module._extensions = ObjectCreate(null);

```

### 导入模块：`Module.require()`

导入模块的方法`require()`会调用`Module_load()`方法：

```javascript
Module.prototype.require = function(id) {
  // 校验是否为字符串
  validateString(id, 'id');
  if (id === '') {
    throw new ERR_INVALID_ARG_VALUE('id', id,
                                    'must be a non-empty string');
  }
  // 加载次数flag
  requireDepth++;
  try {
    return Module._load(id, this, /* isMain */ false);
  } finally {
    requireDepth--;
  }
};

```

### 主要逻辑

`Module_load()`方法会按照如下步骤进行解析：

1.  尝试从`Module._cache`中获取
2.  尝试从 node 内置模块中获取
3.  调用`Module.load()`方法来加载模块

```js
Module._load = function (request, parent, isMain) {
  let relResolveCacheIdentifier;

  // 加载同一个目录下的其它模块
  if (parent) {
    relResolveCacheIdentifier = `${parent.path}\x00${request}`;
    const filename = relativeResolveCache[relResolveCacheIdentifier];
    // 如果存在缓存的话
    if (filename !== undefined) {
      const cachedModule = Module._cache[filename];
      if (cachedModule !== undefined) {
        updateChildren(parent, cachedModule, true);
        // 处理循环引用问题
        // 如果存在于缓存中，但又没有加载完成
        // 表示遇到了循环引用的问题
        // 会给这个模块增加一个警告的代理
        // 然后导出这个模块
        if (!cachedModule.loaded)
          return getExportsForCircularRequire(cachedModule);
        // 返回这个模块
        return cachedModule.exports;
      }
      delete relativeResolveCache[relResolveCacheIdentifier];
    }
  }
  // 模块路径解析
  // 如果是node内置模块则直接返回 request
  // 如果是绝对路径则返回 /node_modules/request
  // 如果相对路径，则会尝试解析request文件夹或者文件
  // 如果都不是
  // 则会逐级向上，在各个上级文件夹的node_modules中寻找该模块
  const filename = Module._resolveFilename(request, parent, isMain);

  // 如果模块名以'node:'开头，则从node内置c++模块中加载
  if (StringPrototypeStartsWith(filename, "node:")) {
    const id = StringPrototypeSlice(filename, 5);
    const module = loadNativeModule(id, request);
    return module.exports;
  }

  // 从Module._cache中获取模块缓存
  const cachedModule = Module._cache[filename];
  if (cachedModule !== undefined) {
    updateChildren(parent, cachedModule, true);

    // 处理循环引用，同上
    if (!cachedModule.loaded) {
      const parseCachedModule = cjsParseCache.get(cachedModule);
      if (!parseCachedModule || parseCachedModule.loaded)
        return getExportsForCircularRequire(cachedModule);
      parseCachedModule.loaded = true;
    } else {
      // 如果没有循环引用问题则直接导出缓存的模块
      return cachedModule.exports;
    }
  }
  // 尝试从node内置模块中寻找
  const mod = loadNativeModule(filename, request);
  if (mod?.canBeRequiredByUsers) return mod.exports;

  // 如果没有在缓存中
  // 也不是内置模块
  // 则会创建一个新的module对象来解析这个模块
  const module = cachedModule || new Module(filename, parent);

  if (isMain) {
    process.mainModule = module;
    module.id = ".";
  }
  // 先将这个module对象存入缓存
  Module._cache[filename] = module;

  if (parent !== undefined) {
    relativeResolveCache[relResolveCacheIdentifier] = filename;
  }

  let threw = true;
  try {
    // 然后尝试去加载这个模块
    module.load(filename);
    threw = false;
  } finally {
    // 如果失败则把恢复之前的缓存状态
    if (threw) {
      delete Module._cache[filename];
      if (parent !== undefined) {
        delete relativeResolveCache[relResolveCacheIdentifier];
        const children = parent?.children;
        if (ArrayIsArray(children)) {
          const index = ArrayPrototypeIndexOf(children, module);
          if (index !== -1) {
            ArrayPrototypeSplice(children, index, 1);
          }
        }
      }
    } else if (
      module.exports &&
      !isProxy(module.exports) &&
      ObjectGetPrototypeOf(module.exports) ===
        CircularRequirePrototypeWarningProxy
    ) {
      ObjectSetPrototypeOf(module.exports, ObjectPrototype);
    }
  }

  return module.exports;
};
```

### 第一次导入

`Module.load()`做了如下几件事：

1.  获取模块可能的路径
2.  获取模块的最长扩展名
3.  根据模块扩展名调用对应的模块加载器

```js
Module.prototype.load = function (filename) {
  assert(!this.loaded);
  this.filename = filename;
  // 获取可能的路径
  this.paths = Module._nodeModulePaths(path.dirname(filename));
  // 获取模块扩展名（.js .json .node）
  const extension = findLongestRegisteredExtension(filename);
  // 加载模块
  Module._extensions[extension](this, filename);
  this.loaded = true;

  // 导出模块
  const ESMLoader = asyncESM.ESMLoader;
  const exports = this.exports;
  if (
    (module?.module === undefined || module.module.getStatus() < kEvaluated) &&
    !ESMLoader.cjsCache.has(this)
  )
    ESMLoader.cjsCache.set(this, exports);
};
```

### 模块加载器

以 json 加载器为例：

```js
Module._extensions[".json"] = function (module, filename) {
  // 调用fs模块同步读取
  const content = fs.readFileSync(filename, "utf8");

  if (policy?.manifest) {
    const moduleURL = pathToFileURL(filename);
    policy.manifest.assertIntegrity(moduleURL, content);
  }

  try {
    // 导出解析好的json字符串对象
    module.exports = JSONParse(stripBOM(content));
  } catch (err) {
    err.message = filename + ": " + err.message;
    throw err;
  }
};
```

## 模块加载顺序

Node.js 官网上给出如下的伪代码：

```javascript
 require(X) from module at path Y
1. If X is a core module,
   a. return the core module
   b. STOP
2. If X begins with '/'
   a. set Y to be the filesystem root
3. If X begins with './' or '/' or '../'
   a. LOAD_AS_FILE(Y + X)
   b. LOAD_AS_DIRECTORY(Y + X)
   c. THROW "not found"
4. If X begins with '#'
   a. LOAD_PACKAGE_IMPORTS(X, dirname(Y))
5. LOAD_PACKAGE_SELF(X, dirname(Y))
6. LOAD_NODE_MODULES(X, dirname(Y))
7. THROW "not found"

LOAD_AS_FILE(X)
1. If X is a file, load X as its file extension format. STOP
2. If X.js is a file, load X.js as JavaScript text. STOP
3. If X.json is a file, parse X.json to a JavaScript Object. STOP
4. If X.node is a file, load X.node as binary addon. STOP

LOAD_INDEX(X)
1. If X/index.js is a file, load X/index.js as JavaScript text. STOP
2. If X/index.json is a file, parse X/index.json to a JavaScript object. STOP
3. If X/index.node is a file, load X/index.node as binary addon. STOP

LOAD_AS_DIRECTORY(X)
1. If X/package.json is a file,
   a. Parse X/package.json, and look for "main" field.
   b. If "main" is a falsy value, GOTO 2.
   c. let M = X + (json main field)
   d. LOAD_AS_FILE(M)
   e. LOAD_INDEX(M)
   f. LOAD_INDEX(X) DEPRECATED
   g. THROW "not found"
2. LOAD_INDEX(X)

LOAD_NODE_MODULES(X, START)
1. let DIRS = NODE_MODULES_PATHS(START)
2. for each DIR in DIRS:
   a. LOAD_PACKAGE_EXPORTS(X, DIR)
   b. LOAD_AS_FILE(DIR/X)
   c. LOAD_AS_DIRECTORY(DIR/X)

NODE_MODULES_PATHS(START)
1. let PARTS = path split(START)
2. let I = count of PARTS - 1
3. let DIRS = [GLOBAL_FOLDERS]
4. while I >= 0,
   a. if PARTS[I] = "node_modules" CONTINUE
   b. DIR = path join(PARTS[0 .. I] + "node_modules")
   c. DIRS = DIRS + DIR
   d. let I = I - 1
5. return DIRS

LOAD_PACKAGE_IMPORTS(X, DIR)
1. Find the closest package scope SCOPE to DIR.
2. If no scope was found, return.
3. If the SCOPE/package.json "imports" is null or undefined, return.
4. let MATCH = PACKAGE_IMPORTS_RESOLVE(X, pathToFileURL(SCOPE),
  ["node", "require"]) defined in the ESM resolver.
5. RESOLVE_ESM_MATCH(MATCH).

LOAD_PACKAGE_EXPORTS(X, DIR)
1. Try to interpret X as a combination of NAME and SUBPATH where the name
   may have a @scope/ prefix and the subpath begins with a slash (`/`).
2. If X does not match this pattern or DIR/NAME/package.json is not a file,
   return.
3. Parse DIR/NAME/package.json, and look for "exports" field.
4. If "exports" is null or undefined, return.
5. let MATCH = PACKAGE_EXPORTS_RESOLVE(pathToFileURL(DIR/NAME), "." + SUBPATH,
   `package.json` "exports", ["node", "require"]) defined in the ESM resolver.
6. RESOLVE_ESM_MATCH(MATCH)

LOAD_PACKAGE_SELF(X, DIR)
1. Find the closest package scope SCOPE to DIR.
2. If no scope was found, return.
3. If the SCOPE/package.json "exports" is null or undefined, return.
4. If the SCOPE/package.json "name" is not the first segment of X, return.
5. let MATCH = PACKAGE_EXPORTS_RESOLVE(pathToFileURL(SCOPE),
   "." + X.slice("name".length), `package.json` "exports", ["node", "require"])
   defined in the ESM resolver.
6. RESOLVE_ESM_MATCH(MATCH)

RESOLVE_ESM_MATCH(MATCH)
1. let { RESOLVED, EXACT } = MATCH
2. let RESOLVED_PATH = fileURLToPath(RESOLVED)
3. If EXACT is true,
   a. If the file at RESOLVED_PATH exists, load RESOLVED_PATH as its extension
      format. STOP
4. Otherwise, if EXACT is false,
   a. LOAD_AS_FILE(RESOLVED_PATH)
   b. LOAD_AS_DIRECTORY(RESOLVED_PATH)
5. THROW "not found"
```

## 循环引用问题

由于 javascript 是一门解释型语言，只有在运行时才能知道真正的变量状态，模块的导入导出以实际运行时的状态为准。
