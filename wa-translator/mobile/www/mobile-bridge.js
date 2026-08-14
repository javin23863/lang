"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy2 = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy2;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy: proxy2,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy2;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/@capacitor/app/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    AppWeb: () => AppWeb
  });
  var AppWeb;
  var init_web = __esm({
    "node_modules/@capacitor/app/dist/esm/web.js"() {
      init_dist();
      AppWeb = class extends WebPlugin {
        constructor() {
          super();
          this.handleVisibilityChange = () => {
            const data = {
              isActive: document.hidden !== true
            };
            this.notifyListeners("appStateChange", data);
            if (document.hidden) {
              this.notifyListeners("pause", null);
            } else {
              this.notifyListeners("resume", null);
            }
          };
          document.addEventListener("visibilitychange", this.handleVisibilityChange, false);
        }
        exitApp() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getInfo() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getLaunchUrl() {
          return { url: "" };
        }
        async getState() {
          return { isActive: document.hidden !== true };
        }
        async minimizeApp() {
          throw this.unimplemented("Not implemented on web.");
        }
        async toggleBackButtonHandler() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getAppLanguage() {
          return {
            value: navigator.language.split("-")[0].toLowerCase()
          };
        }
      };
    }
  });

  // node_modules/@capacitor/share/dist/esm/web.js
  var web_exports2 = {};
  __export(web_exports2, {
    ShareWeb: () => ShareWeb
  });
  var ShareWeb;
  var init_web2 = __esm({
    "node_modules/@capacitor/share/dist/esm/web.js"() {
      init_dist();
      ShareWeb = class extends WebPlugin {
        async canShare() {
          if (typeof navigator === "undefined" || !navigator.share) {
            return { value: false };
          } else {
            return { value: true };
          }
        }
        async share(options) {
          if (typeof navigator === "undefined" || !navigator.share) {
            throw this.unavailable("Share API not available in this browser");
          }
          await navigator.share({
            title: options.title,
            text: options.text,
            url: options.url
          });
          return {};
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js
  var StorageErrorType, KeychainAccess, StorageError;
  var init_definitions = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js"() {
      (function(StorageErrorType2) {
        StorageErrorType2["missingKey"] = "missingKey";
        StorageErrorType2["invalidData"] = "invalidData";
        StorageErrorType2["osError"] = "osError";
        StorageErrorType2["unknownError"] = "unknownError";
      })(StorageErrorType || (StorageErrorType = {}));
      (function(KeychainAccess2) {
        KeychainAccess2[KeychainAccess2["whenUnlocked"] = 0] = "whenUnlocked";
        KeychainAccess2[KeychainAccess2["whenUnlockedThisDeviceOnly"] = 1] = "whenUnlockedThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["afterFirstUnlock"] = 2] = "afterFirstUnlock";
        KeychainAccess2[KeychainAccess2["afterFirstUnlockThisDeviceOnly"] = 3] = "afterFirstUnlockThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["whenPasscodeSetThisDeviceOnly"] = 4] = "whenPasscodeSetThisDeviceOnly";
      })(KeychainAccess || (KeychainAccess = {}));
      StorageError = class extends Error {
        constructor(message, code) {
          super(message);
          this.name = "StorageError";
          this.code = code;
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js
  function isStorageErrorType(value) {
    return value !== void 0 && Object.keys(StorageErrorType).includes(value);
  }
  function parseISODate(isoDate) {
    const match = isoDateRE.exec(isoDate);
    if (match) {
      const year = Number.parseInt(match[1], 10);
      const month = Number.parseInt(match[2], 10) - 1;
      const day = Number.parseInt(match[3], 10);
      const hour = Number.parseInt(match[4], 10);
      const minute = Number.parseInt(match[5], 10);
      const second = Number.parseInt(match[6], 10);
      const millis = Number.parseInt(match[7], 10);
      const epochTime = Date.UTC(year, month, day, hour, minute, second, millis);
      return new Date(epochTime);
    }
    return null;
  }
  var SecureStorageBase, isoDateRE;
  var init_base = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js"() {
      init_dist();
      init_definitions();
      SecureStorageBase = class _SecureStorageBase extends WebPlugin {
        constructor() {
          super(...arguments);
          this.prefix = "capacitor-storage_";
          this.sync = false;
          this.access = KeychainAccess.whenUnlocked;
        }
        async setSynchronize(sync) {
          this.sync = sync;
          if (Capacitor.getPlatform() === "ios") {
            return this.setSynchronizeKeychain({ sync });
          }
        }
        async getSynchronize() {
          return this.sync;
        }
        async setDefaultKeychainAccess(access) {
          this.access = access;
        }
        async tryOperation(operation) {
          try {
            return await operation();
          } catch (error) {
            if (error instanceof CapacitorException && isStorageErrorType(error.code)) {
              throw new StorageError(error.message, error.code);
            }
            throw error;
          }
        }
        async get(key, convertDate = true, sync) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            if (data === null) {
              return null;
            }
            if (convertDate) {
              const date = parseISODate(data);
              if (date) {
                return date;
              }
            }
            try {
              return JSON.parse(data);
            } catch (_a) {
              throw new StorageError("Invalid data", StorageErrorType.invalidData);
            }
          }
          return _SecureStorageBase.missingKey();
        }
        async getItem(key) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return data;
          }
          return null;
        }
        async set(key, data, convertDate = true, sync, access) {
          if (key) {
            let convertedData = data;
            if (convertDate && data instanceof Date) {
              convertedData = data.toISOString();
            }
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: JSON.stringify(convertedData),
              sync: sync !== null && sync !== void 0 ? sync : this.sync,
              access: access !== null && access !== void 0 ? access : this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async setItem(key, value) {
          if (key) {
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: value,
              sync: this.sync,
              access: this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async remove(key, sync) {
          if (key) {
            const { success } = await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            return success;
          }
          return _SecureStorageBase.missingKey();
        }
        async removeItem(key) {
          if (key) {
            await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return;
          }
          _SecureStorageBase.missingKey();
        }
        async keys(sync) {
          const { keys } = await this.tryOperation(async () => this.getPrefixedKeys({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
          const prefixLength = this.prefix.length;
          return keys.map((key) => key.slice(prefixLength));
        }
        async getKeyPrefix() {
          return this.prefix;
        }
        async setKeyPrefix(prefix) {
          this.prefix = prefix;
        }
        prefixedKey(key) {
          return this.prefix + key;
        }
        static missingKey() {
          throw new StorageError("No key provided", StorageErrorType.missingKey);
        }
      };
      isoDateRE = /^"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z"$/u;
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js
  var web_exports3 = {};
  __export(web_exports3, {
    SecureStorageWeb: () => SecureStorageWeb
  });
  var SecureStorageWeb;
  var init_web3 = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js"() {
      init_base();
      SecureStorageWeb = class extends SecureStorageBase {
        // @native
        async setSynchronizeKeychain(_options) {
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalGetItem(options) {
          return { data: localStorage.getItem(options.prefixedKey) };
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalSetItem(options) {
          localStorage.setItem(options.prefixedKey, options.data);
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalRemoveItem(options) {
          const item = localStorage.getItem(options.prefixedKey);
          if (item !== null) {
            localStorage.removeItem(options.prefixedKey);
            return { success: true };
          }
          return { success: false };
        }
        async clear() {
          const { keys } = await this.getPrefixedKeys({ prefix: this.prefix });
          for (const key of keys) {
            localStorage.removeItem(key);
          }
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async clearItemsWithPrefix(_options) {
          console.warn("clearItemsWithPrefix is native only");
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async getPrefixedKeys(options) {
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null || key === void 0 ? void 0 : key.startsWith(options.prefix)) {
              keys.push(key);
            }
          }
          return { keys };
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js
  var native_exports = {};
  __export(native_exports, {
    SecureStorageNative: () => SecureStorageNative
  });
  var SecureStorageNative;
  var init_native = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js"() {
      init_base();
      SecureStorageNative = class extends SecureStorageBase {
        constructor(capProxy) {
          super();
          const proxy2 = capProxy;
          this.setSynchronizeKeychain = proxy2.setSynchronizeKeychain;
          this.internalGetItem = proxy2.internalGetItem;
          this.internalSetItem = proxy2.internalSetItem;
          this.internalRemoveItem = proxy2.internalRemoveItem;
          this.clearItemsWithPrefix = proxy2.clearItemsWithPrefix;
          this.getPrefixedKeys = proxy2.getPrefixedKeys;
        }
        // @native
        async setSynchronizeKeychain(_options) {
        }
        // @native
        async internalGetItem(_options) {
          return { data: "" };
        }
        // @native
        async internalSetItem(_options) {
        }
        // @native
        async internalRemoveItem(_options) {
          return { success: true };
        }
        async clear(sync) {
          return this.tryOperation(async () => this.clearItemsWithPrefix({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
        }
        // @native
        async clearItemsWithPrefix(_options) {
        }
        // @native
        async getPrefixedKeys(_options) {
          return { keys: [] };
        }
      };
    }
  });

  // node_modules/@capacitor/app/dist/esm/index.js
  init_dist();
  var App = registerPlugin("App", {
    web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.AppWeb())
  });

  // src/mobile-bridge.ts
  init_dist();

  // node_modules/@capacitor/share/dist/esm/index.js
  init_dist();
  var Share = registerPlugin("Share", {
    web: () => Promise.resolve().then(() => (init_web2(), web_exports2)).then((m) => new m.ShareWeb())
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/index.js
  init_dist();
  init_definitions();
  var proxy = registerPlugin("SecureStorage", {
    web: async () => {
      const module = await Promise.resolve().then(() => (init_web3(), web_exports3));
      return new module.SecureStorageWeb();
    },
    ios: async () => {
      const module = await Promise.resolve().then(() => (init_native(), native_exports));
      return new module.SecureStorageNative(proxy);
    },
    android: async () => {
      const module = await Promise.resolve().then(() => (init_native(), native_exports));
      return new module.SecureStorageNative(proxy);
    }
  });

  // src/runtime-core.mjs
  var PUBLIC_ORIGIN = "https://spoken-translation-room.spoken-translation-cloudflare.workers.dev";
  var MOBILE_PROTOCOL = 1;
  var MOBILE_BUILD = 1;
  var ROOM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}$/;
  var VERSIONED_PATHS = /* @__PURE__ */ new Map([
    ["/api/capabilities", "/api/v1/capabilities"],
    ["/api/rooms", "/api/v1/rooms"],
    ["/api/room", "/api/v1/room"],
    ["/api/room-control", "/api/v1/room-control"],
    ["/api/room-control/close", "/api/v1/room-control/close"],
    ["/api/turn", "/api/v1/turn"],
    ["/tts", "/api/v1/tts"]
  ]);
  function parseRoomLink(value) {
    try {
      const url = new URL(value);
      if (url.origin !== PUBLIC_ORIGIN || url.search || url.hash) return null;
      const match = url.pathname.match(/^\/room\/([^/]+)$/);
      return match && ROOM_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
    } catch {
      return null;
    }
  }
  function isRoomToken(value) {
    return ROOM_TOKEN_PATTERN.test(String(value || ""));
  }
  function apiPath(path, native) {
    return native ? VERSIONED_PATHS.get(path) || path : path;
  }
  function websocketPath(token, native) {
    if (!isRoomToken(token)) throw new Error("Invalid room token");
    return `${native ? "/ws/v1/" : "/ws/"}${token}`;
  }
  function roomPageUrl(token) {
    if (!isRoomToken(token)) throw new Error("Invalid room token");
    return `room.html?room=${encodeURIComponent(token)}`;
  }
  function validateBootstrap(value, build) {
    if (!value || typeof value !== "object") return false;
    const bootstrap = (
      /** @type {Record<string, unknown>} */
      value
    );
    return bootstrap.protocol === MOBILE_PROTOCOL && Number.isSafeInteger(bootstrap.minimum_build) && Number(bootstrap.minimum_build) <= build && bootstrap.public_origin === PUBLIC_ORIGIN && bootstrap.account === "none" && bootstrap.lifecycle === "foreground";
  }

  // src/mobile-bridge.ts
  var isNative = Capacitor.isNativePlatform();
  var compatibilityReady = isNative ? (async () => {
    const info = await App.getInfo();
    const build = Number.parseInt(info.build, 10);
    const response = await fetch(`${PUBLIC_ORIGIN}/api/v1/mobile/bootstrap`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok || !Number.isSafeInteger(build) || build < MOBILE_BUILD) {
      throw new Error("Mobile compatibility unavailable");
    }
    if (!validateBootstrap(await response.json(), build)) {
      throw new Error("This app version is no longer supported");
    }
    return true;
  })() : Promise.resolve(true);
  function openRoom(token) {
    if (!isRoomToken(token)) return false;
    window.location.replace(roomPageUrl(token));
    return true;
  }
  function routeAppLink(value) {
    const token = value ? parseRoomLink(value) : null;
    if (token) openRoom(token);
  }
  window.LinguaNative = {
    isNative,
    publicOrigin: PUBLIC_ORIGIN,
    apiPath: (path) => apiPath(path, true),
    websocketPath: (token) => websocketPath(token, true),
    isRoomToken,
    ready: () => compatibilityReady,
    async getItem(key) {
      const value = await proxy.get(key);
      return typeof value === "string" ? value : null;
    },
    async setItem(key, value) {
      await proxy.set(key, value);
    },
    async removeItem(key) {
      await proxy.remove(key);
    },
    async share(value) {
      try {
        await Share.share(value);
        return true;
      } catch {
        return false;
      }
    },
    openRoom
  };
  if (isNative) {
    App.addListener("appUrlOpen", (event) => routeAppLink(event.url));
    App.addListener("appStateChange", (state) => {
      window.dispatchEvent(new CustomEvent("lingua-app-state", { detail: state }));
    });
    App.getLaunchUrl().then((value) => routeAppLink(value?.url)).catch(() => {
    });
  }
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
