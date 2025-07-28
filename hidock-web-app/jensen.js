const te = {
    messages: [],
    consoleOutput: !0,
    info(e, t, n) {
      this._append("info", e, t, n);
    },
    debug(e, t, n) {
      this._append("debug", e, t, n);
    },
    error(e, t, n) {
      this._append("error", e, t, n);
    },
    _append(e, t, n, r) {
      const i = {
        level: e,
        module: t,
        procedure: n,
        message: r,
        time: new Date().getTime(),
      };
      this.messages.push(i),
        this.consoleOutput && this._print(i),
        this.messages.length > 15e3 && this.messages.shift();
    },
    _print(e) {
      new Date(e.time);
    },
    filter(e, t) {
      return this.messages.filter((n) => n.module === e && n.procedure === t);
    },
    enableConsoleOutput() {
      this.consoleOutput = !0;
    },
    disableConsoleOutput() {
      this.consoleOutput = !1;
    },
    peek(e) {
      return this.messages.slice(-e);
    },
    search(e, t, n) {
      return this.messages.filter(
        (r) =>
          !(
            r.module !== e ||
            (t && r.procedure !== t) ||
            (n && r.message.indexOf(n) === -1)
          )
      );
    },
  },
  V = (e) => {
    let t =
      e.getFullYear() +
      "-0" +
      (e.getMonth() + 1) +
      "-0" +
      e.getDate() +
      "-0" +
      e.getHours() +
      "-0" +
      e.getMinutes() +
      "-0" +
      e.getSeconds();
    return (
      (t = t.replace(
        /(\d{4})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})/gi,
        "$1$2$3$4$5$6"
      )),
      t
    );
  };
function X(e) {
  return e.match(/.{1,2}/g).map(Number);
}
const ne = {
    CUSTOM_1: 1,
    A: 4,
    B: 5,
    C: 6,
    D: 7,
    E: 8,
    F: 9,
    G: 10,
    H: 11,
    I: 12,
    J: 13,
    K: 14,
    L: 15,
    M: 16,
    N: 17,
    O: 18,
    P: 19,
    Q: 20,
    R: 21,
    S: 22,
    T: 23,
    U: 24,
    V: 25,
    W: 26,
    X: 27,
    Y: 28,
    Z: 27,
    ENTER: 40,
    ESCAPE: 41,
    SPACE: 44,
  },
  l = {
    control: !1,
    shift: !1,
    alt: !1,
    guiKey: !1,
    keys: [],
    withControl: () => ((l.control = !0), l),
    withShift: () => ((l.shift = !0), l),
    withAlt: () => ((l.alt = !0), l),
    withGuiKey: () => ((l.guiKey = !0), l),
    withKey: (e) => {
      if (l.keys.length >= 2) throw new Error("exceed max key bindings");
      return l.keys.push(l.__mapping(e)), l;
    },
    __mapping: (e) => ne[e],
    build: (e = 3, t = 0) => {
      let n = t;
      l.control && (n |= 1),
        l.shift && (n |= 2),
        l.alt && (n |= 4),
        l.guiKey && (n |= 8);
      let r = [
        e,
        n,
        l.keys.length ? l.keys[0] : 0,
        l.keys.length > 1 ? l.keys[1] : 0,
        0,
        0,
        0,
        0,
      ];
      return (
        (l.control = !1),
        (l.shift = !1),
        (l.alt = !1),
        (l.guiKey = !1),
        (l.keys = []),
        r
      );
    },
  },
  w = (e = 0, t = 0, n = 0, r = 0) => {
    let i = 0;
    return e && (i |= 1), t && (i |= 2), n && (i |= 4), r && (i |= 8), [0, i];
  },
  o = [0, 0, 0, 0, 0, 0, 0, 0],
  W = {
    zoom: {
      Windows: [
        ...w(0, 1),
        ...l.build(4, 1),
        ...l.withAlt().withKey("Q").build(),
        ...l.build(4, 16),
        ...o,
      ],
      Mac: [
        ...w(0, 1),
        ...l.build(4, 1),
        ...l.withGuiKey().withKey("W").build(),
        ...l.build(4, 16),
        ...o,
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    teams: {
      Windows: [
        ...w(),
        ...l.withControl().withShift().withKey("A").build(),
        ...l.withControl().withShift().withKey("H").build(),
        ...l.withControl().withShift().withKey("D").build(),
        ...l.withControl().withShift().withKey("M").build(),
      ],
      Mac: [
        ...w(),
        ...l.withGuiKey().withShift().withKey("A").build(),
        ...l.withGuiKey().withShift().withKey("H").build(),
        ...l.withGuiKey().withShift().withKey("D").build(),
        ...l.withGuiKey().withShift().withKey("M").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    "google-meeting": {
      Windows: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withControl().withKey("D").build(),
      ],
      Mac: [...w(), ...o, ...o, ...o, ...l.withGuiKey().withKey("D").build()],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    webex: {
      Windows: [
        ...w(),
        ...l.withControl().withShift().withKey("C").build(),
        ...l.withControl().withKey("L").build(),
        ...l.withControl().withKey("D").build(),
        ...l.withControl().withKey("M").build(),
      ],
      Mac: [
        ...w(),
        ...l.withControl().withShift().withKey("C").build(),
        ...l.withGuiKey().withKey("L").build(),
        ...l.withGuiKey().withShift().withKey("D").build(),
        ...l.withGuiKey().withShift().withKey("M").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    feishu: {
      Windows: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withControl().withShift().withKey("D").build(),
      ],
      Mac: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withGuiKey().withShift().withKey("D").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    lark: {
      Windows: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withControl().withShift().withKey("D").build(),
      ],
      Mac: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withGuiKey().withShift().withKey("D").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    wechat: {
      Windows: [...w(), ...o, ...o, ...o, ...o],
      Mac: [...w(), ...o, ...o, ...o, ...o],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    line: {
      Windows: [
        ...w(0, 1, 1),
        ...o,
        ...l.withKey("ESCAPE").build(),
        ...l.withKey("ESCAPE").build(),
        ...l.withControl().withShift().withKey("A").build(),
      ],
      Mac: [
        ...w(0, 1, 1),
        ...o,
        ...l.withKey("ESCAPE").build(),
        ...l.withKey("ESCAPE").build(),
        ...l.withGuiKey().withShift().withKey("A").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    "whats-app": {
      Windows: [...w(), ...o, ...o, ...o, ...o],
      Mac: [
        ...w(),
        ...o,
        ...l.withGuiKey().withKey("W").build(),
        ...l.withGuiKey().withKey("W").build(),
        ...l.withGuiKey().withShift().withKey("M").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    slack: {
      Windows: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withControl().withShift().withKey("SPACE").build(),
      ],
      Mac: [
        ...w(),
        ...o,
        ...o,
        ...o,
        ...l.withGuiKey().withShift().withKey("SPACE").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
    discord: {
      Windows: [
        ...w(),
        l.withControl().withKey("ENTER").build(),
        ...o,
        ...l.withKey("ESCAPE").build(),
        ...l.withControl().withShift().withKey("M").build(),
      ],
      Mac: [
        ...w(),
        ...l.withGuiKey().withKey("ENTER").build(),
        ...o,
        ...l.withGuiKey().withKey("ESCAPE").build(),
        ...l.withGuiKey().withShift().withKey("M").build(),
      ],
      Linux: [...w(), ...o, ...o, ...o, ...o],
    },
  },
  ie = 0,
  re = 1,
  oe = 2,
  se = 3,
  de = 4,
  le = 5,
  he = 6,
  ue = 7,
  ae = 8,
  ce = 9,
  ye = 16,
  fe = 17,
  ge = 18,
  we = 19,
  pe = 20,
  be = 10,
  me = 10,
  Ce = 11,
  P = 12,
  G = 13,
  _ = 61451,
  z = 4097,
  U = 4098,
  Y = 4099,
  J = 61447,
  ve = 61448,
  Ke = 61449,
  O = {
    [ie]: "invalid-0",
    [re]: "get-device-info",
    [oe]: "get-device-time",
    [se]: "set-device-time",
    [de]: "get-file-list",
    [le]: "transfer-file",
    [he]: "get-file-count",
    [ue]: "delete-file",
    [ae]: "request-firmware-upgrade",
    [ce]: "firmware-upload",
    [ye]: "read card info",
    [fe]: "format card",
    [ge]: "get recording file",
    [we]: "restore factory settings",
    [pe]: "send meeting schedule info",
    [be]: "device msg test",
    [me]: "bnc demo test",
    [Ce]: "get-settings",
    [P]: "set-settings",
    [G]: "get file block",
    [_]: "factory reset",
    [J]: "test sn write",
    [ve]: "record test start",
    [Ke]: "record test end",
    [z]: "bluetooth-scan",
    [U]: "bluetooth-cmd",
    [Y]: "bluetooth-status",
  };
let p = null;
function s(e) {
  p = e || te;
  let t = null,
    n = {},
    r = [],
    i = 0,
    h = null,
    a = [],
    b = null,
    k = !1,
    y = 0,
    g = this;
  (this.data = {}),
    (this.decodeTimeout = 0),
    (this.timewait = 1),
    (this.ondisconnect = null),
    (this.isStopConnectionCheck = !1),
    (this.onconnect = null),
    (this.onreceive = null);
  const D = () => {
      if ((t == null ? void 0 : t.opened) === !1)
        try {
          clearTimeout(b);
          const d = document.getElementById("test_audio");
          d && d.remove(),
            this.ondisconnect &&
              !this.isStopConnectionCheck &&
              this.ondisconnect();
        } catch {}
      b = setTimeout(() => {
        D();
      }, 100);
    },
    I = async function (d) {
      var u;
      (g.versionCode = null), (g.versionNumber = null), (a.length = 0);
      try {
        await t.selectConfiguration(1),
          await t.claimInterface(0),
          await t.selectAlternateInterface(0, 0),
          (g.model =
            t.productId == 45068
              ? "hidock-h1"
              : t.productId == 45069
              ? "hidock-h1e"
              : t.productId == 45070
              ? "hidock-p1"
              : "unknown");
      } catch (f) {
        p.error("jensen", "setup", String(f));
      }
      d || D(),
        (h = null),
        (k = !1),
        p.debug("jensen", "setup", "setup webusb connection");
      try {
        d || g.isStopConnectionCheck || (u = g.onconnect) == null || u.call(g);
      } catch (f) {
        p.error("jensen", "setup", f);
      }
    };
  (this.connect = async function () {
    if ((p.debug("jensen", "connect", "connect"), await g.tryconnect())) return;
    let d = await navigator.usb.requestDevice({
      filters: [{ vendorId: 4310 }],
    });
    await d.open(), (t = d), await I();
  }),
    (this.getModel = function () {
      return this.model;
    }),
    (this.init = async function () {
      navigator.usb
        ? ((navigator.usb.onconnect = function (d) {
            g.tryconnect();
          }),
          await g.connect())
        : p.error("jensen", "init", "webusb not supported");
    }),
    (this.tryconnect = async function (d) {
      await this.disconnect();
      let u = await navigator.usb.getDevices();
      for (let f = 0; f < u.length; f++) {
        let K = u[f];
        if (K.productName.indexOf("HiDock") > -1)
          return (
            p.debug("jensen", "tryconnect", "detected: " + K.productName),
            await K.open(),
            (t = K),
            await I(d),
            !0
          );
      }
      return p.debug("jensen", "tryconnect", "no HiDock found"), !1;
    }),
    (this.isConnected = function () {
      return t != null;
    }),
    (this.disconnect = async function () {
      p.info("jensen", "disconnect", "disconnect");
      try {
        await (t == null ? void 0 : t.close());
      } catch {}
    }),
    (this.send = function (d, u, f) {
      return (
        d.sequence(i++),
        (d.onprogress = f),
        u && d.expireAfter(u),
        a.push(d),
        j(),
        B(d, u)
      );
    });
  const j = async function () {
      if (h) return;
      let d = null,
        u = new Date().getTime();
      for (;;) {
        if (a.length == 0) return;
        if (((d = a.shift()), !(d.expireTime > 0 && d.expireTime < u))) break;
        p.info(
          "jensen",
          "sendNext",
          "expired: cmd-" + d.command + "-" + d.index + ", " + O[d.command]
        );
      }
      let f = d.make();
      (h = "cmd-" + d.command + "-" + d.index),
        p.debug(
          "jensen",
          "sendNext",
          "command: " + O[d.command] + ", data bytes: " + f.byteLength
        ),
        (g.timewait = d.command == 5 || d.command == G ? 1e3 : 10),
        await t.transferOut(1, f).catch((K) =>
          (async function (C, T) {
            p.error("jensen", "sendNext", String(T)),
              (g.versionCode = null),
              (g.versionNumber = null);
          })(0, K)
        ),
        d.onprogress && d.onprogress(1, 1),
        (y = 0),
        k == 0 ? R() : (k = !0);
    },
    B = function (d, u) {
      let f = "cmd-" + d.command + "-" + d.index,
        K = u
          ? setTimeout(() => {
              x(f);
            }, 1e3 * u)
          : null;
      return new Promise((C, T) => {
        n[f] = { tag: f, resolve: C, reject: T, timeout: K };
      });
    },
    m = function (d, u) {
      if (h == null) return;
      if (
        (p.debug(
          "jensen",
          "trigger",
          "trigger - " + h.substring(0, h.lastIndexOf("-")) + " <---> cmd-" + u
        ),
        h.substring(0, h.lastIndexOf("-")) != "cmd-" + u)
      )
        return void (h = null);
      if (h in n == 0)
        return void p.debug("jensen", "trigger", "no action registered");
      let f = n[h];
      f.timeout && clearTimeout(f.timeout),
        f.resolve(d),
        delete n[h],
        (h = null);
    },
    x = function (d) {
      p.debug("jensen", "timeout", "timeout " + d),
        n[d].resolve(null),
        delete n[d];
    };
  this.dump = function () {};
  const R = function () {
      t &&
        t.transferIn(2, 51200).then((d) => {
          var u;
          (u = p.save) == null ||
            u.call(p, "jensen", "tryReceive", d == null ? void 0 : d.data),
            N(d);
        });
    },
    F = function (d, u, f, K) {
      return arguments.length === 2
        ? ((255 & d) << 8) | (255 & u)
        : arguments.length === 4
        ? ((255 & d) << 24) | ((255 & u) << 16) | ((255 & f) << 8) | (255 & K)
        : void 0;
    },
    N = function (d) {
      if (
        ((y += d.data.byteLength),
        r.push(d.data),
        R(),
        g.decodeTimeout && clearTimeout(g.decodeTimeout),
        (g.decodeTimeout = setTimeout(function () {
          E();
        }, g.timewait)),
        g.onreceive)
      )
        try {
          g.onreceive(y);
        } catch {}
    },
    E = function () {
      var C, T;
      let d = new ArrayBuffer(102400),
        u = new Uint8Array(d),
        f = 0,
        K = !1;
      for (let q = 0, M = r.length; q < M; q++) {
        let L = r.shift();
        for (let v = 0; v < L.byteLength; v++) u[v + f] = L.getInt8(v);
        f += L.byteLength;
        let H = 0;
        for (;;) {
          let v = null;
          try {
            v = Z(u, H, f);
          } catch {
            K = !0;
            break;
          }
          if (v == null) break;
          H += v.length;
          let S = v.message,
            ee = S.id === _ ? "factory-reset" : O[S.id],
            Q = [];
          for (
            let A = 0;
            A < ((C = S.body) == null ? void 0 : C.byteLength) && A < 32;
            A++
          )
            Q.push(
              "0" + (255 & S.body[A]).toString(16).replace(/^0(\w{2})$/gi, "$1")
            );
          S.id !== 5 &&
            p.debug(
              "jensen",
              "receive",
              "recv: " +
                ee +
                ", seq: " +
                S.sequence +
                ", data bytes: " +
                ((T = S.body) == null ? void 0 : T.byteLength) +
                ", data: " +
                Q.join(" ")
            );
          try {
            let A = (0, s.handlers[S.id])(S, g);
            A && m(A, S.id);
          } catch (A) {
            m(A),
              p.error(
                "jensen",
                "receive",
                "recv: " +
                  O[S.id] +
                  ", seq: " +
                  S.sequence +
                  ", error: " +
                  String(A)
              );
          }
          j();
        }
        if (K) {
          let v = parseInt(h.replace(/^cmd-(\d+)-(\d+)$/gi, "$1"));
          try {
            (0, s.handlers[v])(null, g);
          } catch (S) {
            m(S), p.error("jensen", "decode", "decode error: " + String(S));
          }
          m(null, v), (r.length = 0);
          break;
        }
        for (let v = 0, S = f - H; v < S; v++) u[v] = u[v + H];
        f -= H;
      }
    },
    Z = function (d, u, f) {
      let K = f - u;
      if (K < 12) return null;
      if (d[u + 0] !== 18 || d[u + 1] !== 52) throw new Error("invalid header");
      let C = 2,
        T = F(d[u + C], d[u + C + 1]);
      C += 2;
      let q = F(d[u + C + 0], d[u + C + 1], d[u + C + 2], d[u + C + 3]);
      C += 4;
      let M = F(d[u + C + 0], d[u + C + 1], d[u + C + 2], d[u + C + 3]),
        L = (M >> 24) & 255;
      (M &= 16777215), (C += 4);
      var H = 0;
      if (K < 12 + M + L) return null;
      H += 12;
      let v = d.slice(u + H, u + H + M);
      return (H += M), (H += L), { message: new Se(T, q, v), length: H };
    };
  (this.to_bcd = function (d) {
    let u = [];
    for (let f = 0; f < d.length; f += 2) {
      let K = (d.charCodeAt(f) - 48) & 255,
        C = (d.charCodeAt(f + 1) - 48) & 255;
      u.push((K << 4) | C);
    }
    return u;
  }),
    (this.from_bcd = function () {
      let d = "";
      for (let u = 0; u < arguments.length; u++) {
        let f = 255 & arguments[u];
        (d += (f >> 4) & 15), (d += 15 & f);
      }
      return d;
    });
}
function c(e) {
  (this.command = e),
    (this.msgBody = []),
    (this.index = 0),
    (this.expireTime = 0),
    (this.timeout = 0),
    (this.body = function (t) {
      return (this.msgBody = t), this;
    }),
    (this.expireAfter = function (t) {
      this.expireTime = new Date().getTime() + 1e3 * t;
    }),
    (this.sequence = function (t) {
      return (this.index = t), this;
    }),
    (this.make = function () {
      let t = new Uint8Array(12 + this.msgBody.length),
        n = 0;
      (t[n++] = 18),
        (t[n++] = 52),
        (t[n++] = (this.command >> 8) & 255),
        (t[n++] = 255 & this.command),
        (t[n++] = (this.index >> 24) & 255),
        (t[n++] = (this.index >> 16) & 255),
        (t[n++] = (this.index >> 8) & 255),
        (t[n++] = 255 & this.index);
      let r = this.msgBody.length;
      (t[n++] = (r >> 24) & 255),
        (t[n++] = (r >> 16) & 255),
        (t[n++] = (r >> 8) & 255),
        (t[n++] = 255 & r);
      for (let i = 0; i < this.msgBody.length; i++)
        t[n++] = 255 & this.msgBody[i];
      return t;
    });
}
function Se(e, t, n) {
  (this.id = e), (this.sequence = t), (this.body = n);
}
(s.registerHandler = function (e, t) {
  s.handlers === void 0 && (s.handlers = {}), (s.handlers[e] = t);
}),
  (s.prototype.getDeviceInfo = async function (e) {
    return this.send(new c(1), e);
  }),
  (s.prototype.getTime = async function (e) {
    return this.send(new c(2), e);
  }),
  (s.prototype.getFileCount = async function (e) {
    return this.send(new c(6), e);
  }),
  (s.prototype.factoryReset = async function (e) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327705
      ? null
      : this.send(new c(_), e);
  }),
  (s.prototype.restoreFactorySettings = async function (e) {
    return (this.model === "hidock-h1e" && this.versionNumber < 393476) ||
      (this.model === "hidock-h1" && this.versionNumber < 327944)
      ? null
      : this.send(new c(19).body([1, 2, 3, 4]), e);
  }),
  (s.prototype.scanDevices = async function (e) {
    return this.model != "hidock-p1" ? null : this.send(new c(z), e || 20);
  }),
  (s.prototype.connectBTDevice = async function (e, t) {
    if (this.model != "hidock-p1") return null;
    let n = e.split("-");
    if (n.length != 6) throw new Error("invalid mac");
    let r = [];
    for (let i = 0; i < n.length; i++) r[i] = parseInt(n[i], 16);
    return this.send(new c(U).body([0].concat(r)), t);
  }),
  (s.prototype.disconnectBTDevice = async function (e) {
    return this.model != "hidock-p1" ? null : this.send(new c(U).body([1]), e);
  }),
  (s.prototype.getBluetoothStatus = async function (e) {
    return this.model != "hidock-p1" ? null : this.send(new c(Y), e);
  }),
  (s.prototype.listFiles = async function () {
    let e = "filelist";
    if (this[e] != null) return null;
    let t = null;
    return ((this.versionNumber === void 0 || this.versionNumber <= 327722) &&
      ((t = await this.getFileCount(5)), t == null)) ||
      (t && t.count == 0)
      ? null
      : ((this[e] = []),
        s.registerHandler(4, (n, r) => {
          if (n.body.length == 0) return (r[e] = null), [];
          r[e].push(n.body);
          let i = [],
            h = [],
            a = -1,
            b = 0;
          for (let y = 0; y < r[e].length; y++)
            for (let g = 0; g < r[e][y].length; g++) i.push(r[e][y][g]);
          255 & ~i[0] ||
            255 & ~i[1] ||
            ((a =
              ((255 & i[2]) << 24) |
              ((255 & i[3]) << 16) |
              ((255 & i[4]) << 8) |
              (255 & i[5])),
            (b += 6));
          let k = function (y) {
            return y > 9 ? y : "0" + y;
          };
          for (let y = b; y < i.length; ) {
            let g = [];
            if (y + 4 >= i.length) break;
            let D = 255 & i[y++],
              I =
                ((255 & i[y++]) << 16) | ((255 & i[y++]) << 8) | (255 & i[y++]);
            for (let N = 0; N < I && y < i.length; N++) {
              let E = 255 & i[y++];
              E > 0 && g.push(String.fromCharCode(E));
            }
            if (y + 4 + 6 + 16 > i.length) break;
            let j =
              ((255 & i[y++]) << 24) |
              ((255 & i[y++]) << 16) |
              ((255 & i[y++]) << 8) |
              (255 & i[y++]);
            y += 6;
            let B = [];
            for (let N = 0; N < 16; N++, y++) {
              let E = (255 & i[y]).toString(16);
              B.push(E.length == 1 ? "0" + E : E);
            }
            let m = g.join(""),
              x = 0;
            m.match(/^\d{14}REC\d+\.wav$/gi)
              ? ((m = m.replace(
                  /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})REC.*$/gi,
                  "$1-$2-$3 $4:$5:$6"
                )),
                (m = new Date(m)),
                (x = j / 32))
              : m.match(
                  /^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.(hda|wav)$/gi
                )
              ? ((m = m.replace(
                  /^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.(hda|wav)$/gi,
                  "20$2 $3 $4 $5:$6:$7"
                )),
                (m = new Date(m)),
                (x = (j / 32) * 4))
              : (m = null),
              D == 1
                ? (x *= 2)
                : D == 2
                ? (x = (j - 44) / 48 / 2)
                : D == 3
                ? (x = (j - 44) / 48 / 2 / 2)
                : D == 5 && (x = j / 12);
            let R = "",
              F = "";
            m &&
              ((R =
                m.getFullYear() +
                "/" +
                k(m.getMonth() + 1) +
                "/" +
                k(m.getDate())),
              (F =
                k(m.getHours()) +
                ":" +
                k(m.getMinutes()) +
                ":" +
                k(m.getSeconds()))),
              h.push({
                name: g.join(""),
                createDate: R,
                createTime: F,
                time: m,
                duration: x,
                version: D,
                length: j,
                signature: B.join(""),
              });
          }
          return (t && h.length >= t.count) || (a > -1 && h.length >= a)
            ? ((r[e] = null), h.filter((y) => !!y.time))
            : void 0;
        }),
        this.send(new c(4)));
  }),
  (s.prototype.deleteFile = async function (e, t) {
    let n = [];
    for (let r = 0; r < e.length; r++) n.push(e.charCodeAt(r));
    return this.send(new c(7).body(n), t);
  }),
  (s.prototype.readFile = async function (e, t, n, r) {
    let i = [];
    i.push((t >> 24) & 255),
      i.push((t >> 16) & 255),
      i.push((t >> 8) & 255),
      i.push(255 & t),
      i.push((n >> 24) & 255),
      i.push((n >> 16) & 255),
      i.push((n >> 8) & 255),
      i.push(255 & n);
    for (let h = 0; h < e.length; h++) i.push(e.charCodeAt(h));
    return this.send(new c(21).body(i), r);
  }),
  (s.prototype.setTime = async function (e, t) {
    let n =
      e.getFullYear() +
      "-0" +
      (e.getMonth() + 1) +
      "-0" +
      e.getDate() +
      "-0" +
      e.getHours() +
      "-0" +
      e.getMinutes() +
      "-0" +
      e.getSeconds();
    return (
      (n = n.replace(
        /(\d{4})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})\-0*(\d{2})/gi,
        "$1$2$3$4$5$6"
      )),
      this.send(new c(3).body(this.to_bcd(n)), t)
    );
  }),
  (s.prototype.streaming = async function (e, t, n, r) {
    if (typeof t != "number") throw new Error("parameter `length` required");
    if (t <= 0) throw new Error("parameter `length` must greater than zero");
    p.info(
      "jensen",
      "streaming",
      `file download start. filename: ${e}, length: ${t} `
    );
    let i = [];
    for (let a = 0; a < e.length; a++) i.push(e.charCodeAt(a));
    let h = 0;
    (this.onreceive = r),
      s.registerHandler(5, (a) => {
        if (a != null) {
          if (
            ((h += a.body.length || a.body.byteLength),
            n(a.body),
            p.info("jensen", "streaming length", `${t} ${h}`),
            h >= t)
          )
            return p.info("jensen", "streaming", "file download finish."), "OK";
        } else p.info("jensen", "streaming", "file download fail."), n("fail");
      }),
      this.send(new c(5).body(i));
  }),
  (s.prototype.getFilePart = async function (e, t, n, r) {
    if (typeof t != "number") throw new Error("parameter `length` required");
    if (t <= 0) throw new Error("parameter `length` must greater than zero");
    p.info(
      "jensen",
      "getFilePart",
      `file download start. filename: ${e}, length: ${t} `
    );
    let i = [];
    i.push((t >> 24) & 255),
      i.push((t >> 16) & 255),
      i.push((t >> 8) & 255),
      i.push(255 & t);
    for (let a = 0; a < e.length; a++) i.push(e.charCodeAt(a));
    let h = 0;
    (this.onreceive = r),
      s.registerHandler(G, (a) => {
        if (a != null) {
          if (
            ((h += a.body.length || a.body.byteLength),
            n(a.body),
            p.info("jensen", "getFilePart length", `${t} ${h}`),
            h >= t)
          )
            return (
              p.info("jensen", "getFilePart", "file download finish."), "OK"
            );
        } else
          p.info("jensen", "getFilePart", "file download fail."), n("fail");
      }),
      this.send(new c(G).body(i));
  }),
  (s.prototype.getFile = async function (e, t, n, r) {
    if (typeof t != "number") throw new Error("parameter `length` required");
    if (t <= 0) throw new Error("parameter `length` must greater than zero");
    p.info(
      "jensen",
      "getFile",
      `file download start. filename: ${e}, length: ${t} `
    );
    let i = [];
    for (let b = 0; b < e.length; b++) i.push(e.charCodeAt(b));
    let h = new Date(),
      a = 0;
    (this.onreceive = r),
      s.registerHandler(5, (b) => {
        if (b == null)
          return (
            p.info("jensen", "getFile", "file transfer fail."),
            n("fail"),
            "fail"
          );
        if (((a += b.body.length || b.body.byteLength), n(b.body), a >= t)) {
          p.info("jensen", "getFile", "file transfer finish.");
          let k = new Date().getTime() - h.getTime();
          return p.info("jensen", "getFile", "cost " + k + " ms"), "OK";
        }
      }),
      this.send(new c(5).body(i));
  }),
  (s.prototype.requestFirmwareUpgrade = async function (e, t, n) {
    let r = [];
    return (
      (r[0] = (e >> 24) & 255),
      (r[1] = (e >> 16) & 255),
      (r[2] = (e >> 8) & 255),
      (r[3] = 255 & e),
      (r[4] = (t >> 24) & 255),
      (r[5] = (t >> 16) & 255),
      (r[6] = (t >> 8) & 255),
      (r[7] = 255 & t),
      this.send(new c(8).body(r), n)
    );
  }),
  (s.prototype.uploadFirmware = async function (e, t, n) {
    return this.send(new c(9).body(e), t, n);
  }),
  (s.prototype.beginBNC = async function (e) {
    return this.send(new c(10).body([1]), e);
  }),
  (s.prototype.endBNC = async function (e) {
    return this.send(new c(10).body([0]), e);
  }),
  (s.prototype.getSettings = async function (e) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327714
      ? { autoRecord: !1, autoPlay: !1 }
      : this.send(new c(11), e);
  }),
  (s.prototype.setAutoRecord = function (e, t) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327714
      ? { result: !1 }
      : this.send(new c(P).body([0, 0, 0, e ? 1 : 2]), t);
  }),
  (s.prototype.setAutoPlay = function (e, t) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327714
      ? { result: !1 }
      : this.send(new c(P).body([0, 0, 0, 0, 0, 0, 0, e ? 1 : 2]), t);
  }),
  (s.prototype.setNotification = function (e, t) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327714
      ? { result: !1 }
      : this.send(
          new c(P).body([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, e ? 1 : 2]),
          t
        );
  }),
  (s.prototype.setBluetoothPromptPlay = function (e, t) {
    return (this.model === "hidock-h1e" && this.versionNumber < 393476) ||
      (this.model === "hidock-h1" && this.versionNumber < 327940)
      ? { result: !1 }
      : this.send(
          new c(P).body([
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            e ? 2 : 1,
          ]),
          t
        );
  }),
  (s.prototype.getCardInfo = function (e) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327733
      ? null
      : this.send(new c(16), e);
  }),
  (s.prototype.formatCard = function (e) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327733
      ? null
      : this.send(new c(17).body([1, 2, 3, 4]), e);
  }),
  (s.prototype.getRecordingFile = function (e) {
    return (this.model == "hidock-h1" || this.model == "hidock-h1e") &&
      this.versionNumber < 327733
      ? null
      : this.send(new c(18), e);
  }),
  (s.prototype.recordTestStart = async function (e, t) {
    return this.send(new c(61448).body([e]), t);
  }),
  (s.prototype.recordTestEnd = async function (e, t) {
    return this.send(new c(61449).body([e]), t);
  }),
  (s.prototype.test = async function (e) {
    return this.send(new c(10), e);
  }),
  (s.prototype.getFileBlock = async function (e, t, n) {
    if (typeof t != "number") throw new Error("parameter `length` required");
    if (t <= 0) throw new Error("parameter `length` must greater than zero");
    if (this.fileLength > 0) return null;
    let r = [];
    r.push((t >> 24) & 255),
      r.push((t >> 16) & 255),
      r.push((t >> 8) & 255),
      r.push(255 & t);
    for (let i = 0; i < e.length; i++) r.push(e.charCodeAt(i));
    return (
      (this.onFileRecvHandler = n),
      (this.fileLength = t),
      (this.fileReadBytes = 0),
      this.send(new c(G).body(r))
    );
  }),
  (s.prototype.writeSerialNumber = async function (e) {
    let t = [];
    for (let n = 0; n < e.length; n++) t.push(e.charCodeAt(n));
    return this.send(new c(J).body(t));
  });
const $ = (e) => ({ result: e.body[0] === 0 ? "success" : "failed" });
(s.prototype.sendScheduleInfo = function (e) {
  if (Array.isArray(e) && e.length) {
    let t = [];
    for (const n of e) {
      let r = new Array(34).fill(0);
      W[n.platform] && W[n.platform][n.os] && (r = W[n.platform][n.os]);
      let i = new Array(8).fill(0),
        h = new Array(8).fill(0);
      n.startDate &&
        n.endDate &&
        ((i = X(V(n.startDate))), (h = X(V(n.endDate))), i.push(0), h.push(0));
      const a = [0, 0];
      t = t.concat([...i, ...h, ...a, ...r]);
    }
    return this.send(new c(20).body(t));
  }
  {
    const t = new Array(52).fill(0);
    return this.send(new c(20).body(t));
  }
}),
  (s.prototype.getRealtimeSettings = async function () {
    return this.send(new c(32));
  }),
  (s.prototype.startRealtime = async function () {
    return this.send(new c(33).body([0, 0, 0, 0, 0, 0, 0, 1]));
  }),
  (s.prototype.pauseRealtime = async function () {
    return this.send(new c(33).body([0, 0, 0, 1, 0, 0, 0, 1]));
  }),
  (s.prototype.stopRealtime = async function () {
    return this.send(new c(33).body([0, 0, 0, 2, 0, 0, 0, 1]));
  }),
  (s.prototype.getRealtime = async function (e) {
    let t = (e >> 24) & 255,
      n = (e >> 16) & 255,
      r = (e >> 8) & 255,
      i = 255 & e;
    return this.send(new c(34).body([t, n, r, i]));
  }),
  (s.prototype.requestToneUpdate = async function (e, t, n) {
    let r = [];
    for (let i = 0; i < e.length; i += 2) {
      let h = e.substring(i, i + 2);
      r.push(parseInt(h, 16));
    }
    return (
      r.push((t >> 24) & 255),
      r.push((t >> 16) & 255),
      r.push((t >> 8) & 255),
      r.push(255 & t),
      this.send(new c(22).body(r), n)
    );
  }),
  (s.prototype.updateTone = async function (e, t) {
    return this.send(new c(23).body(e), t);
  }),
  (s.prototype.requestUACUpdate = async function (e, t, n) {
    let r = [];
    for (let i = 0; i < e.length; i += 2) {
      let h = e.substring(i, i + 2);
      r.push(parseInt(h, 16));
    }
    return (
      r.push((t >> 24) & 255),
      r.push((t >> 16) & 255),
      r.push((t >> 8) & 255),
      r.push(255 & t),
      this.send(new c(24).body(r), n)
    );
  }),
  (s.prototype.updateUAC = async function (e, t) {
    return this.send(new c(25).body(e), t);
  }),
  s.registerHandler(33, $),
  s.registerHandler(32, (e) => e),
  s.registerHandler(34, (e) => ({
    rest:
      ((255 & e.body[0]) << 24) |
      ((255 & e.body[1]) << 16) |
      ((255 & e.body[2]) << 8) |
      (255 & e.body[3]),
    data: e.body,
  })),
  s.registerHandler(3, $),
  s.registerHandler(10, $),
  s.registerHandler(7, (e) => {
    let t = "failed";
    return (
      e.body[0] === 0
        ? (t = "success")
        : e.body[0] === 1
        ? (t = "not-exists")
        : e.body[0] === 2 && (t = "failed"),
      { result: t }
    );
  }),
  s.registerHandler(1, (e, t) => {
    let n = [],
      r = 0,
      i = [];
    for (let h = 0; h < 4; h++) {
      let a = 255 & e.body[h];
      h > 0 && n.push(String(a)), (r |= a << (8 * (4 - h - 1)));
    }
    for (let h = 0; h < 16; h++) {
      let a = e.body[h + 4];
      a > 0 && i.push(String.fromCharCode(a));
    }
    return (
      (t.versionCode = n.join(".")),
      (t.versionNumber = r),
      (i = i.join("")),
      (t.serialNumber = i),
      { versionCode: n.join("."), versionNumber: r, sn: i }
    );
  }),
  s.registerHandler(2, (e, t) => {
    let n = t.from_bcd(
      255 & e.body[0],
      255 & e.body[1],
      255 & e.body[2],
      255 & e.body[3],
      255 & e.body[4],
      255 & e.body[5],
      255 & e.body[6]
    );
    return {
      time:
        n === "00000000000000"
          ? "unknown"
          : n.replace(
              /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/gi,
              "$1-$2-$3 $4:$5:$6"
            ),
    };
  }),
  s.registerHandler(6, (e) => {
    if (e.body.length === 0) return { count: 0 };
    let t = 0;
    for (let n = 0; n < 4; n++) t |= (255 & e.body[n]) << (8 * (4 - n - 1));
    return { count: t };
  }),
  s.registerHandler(11, (e) => {
    let t = {
      autoRecord: e.body[3] === 1,
      autoPlay: e.body[7] === 1,
      bluetoothTone: e.body[15] !== 1,
    };
    if (e.body.length >= 12) {
      let n = e.body[11] === 1;
      t.notification = n;
    }
    return t;
  }),
  s.registerHandler(P, $),
  s.registerHandler(_, $),
  s.registerHandler(19, $),
  s.registerHandler(8, (e) => {
    let t = "unknown",
      n = e.body[0];
    return (
      n === 0
        ? (t = "accepted")
        : n === 1
        ? (t = "wrong-version")
        : n === 2
        ? (t = "busy")
        : n === 3
        ? (t = "card-full")
        : n == 4 && (t = "card-error"),
      { result: t }
    );
  }),
  s.registerHandler(9, (e) => ({
    result: e.body[0] === 0 ? "success" : "failed",
  })),
  s.registerHandler(16, (e) => {
    let t = 0;
    return {
      used:
        ((255 & e.body[t++]) << 24) |
        ((255 & e.body[t++]) << 16) |
        ((255 & e.body[t++]) << 8) |
        (255 & e.body[t++]),
      capacity:
        ((255 & e.body[t++]) << 24) |
        ((255 & e.body[t++]) << 16) |
        ((255 & e.body[t++]) << 8) |
        (255 & e.body[t++]),
      status: (
        ((255 & e.body[t++]) << 24) |
        ((255 & e.body[t++]) << 16) |
        ((255 & e.body[t++]) << 8) |
        (255 & e.body[t++])
      ).toString(16),
    };
  }),
  s.registerHandler(21, (e) => {
    let t = new Uint8Array(e.body.length);
    for (let n = 0; n < e.body.length; n++) t[n] = 255 & e.body[n];
    return t;
  }),
  s.registerHandler(17, $),
  s.registerHandler(18, (e) => {
    if (e.body == null || e.body.length === 0) return { recording: null };
    {
      let n = [];
      for (var t = 0; t < e.body.length; t++)
        n.push(String.fromCharCode(e.body[t]));
      let r = function (b) {
          return b > 9 ? b : "0" + b;
        },
        i = n.join("");
      i.match(/^\d{14}REC\d+\.wav$/gi)
        ? ((i = i.replace(
            /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})REC.*$/gi,
            "$1-$2-$3 $4:$5:$6"
          )),
          (i = new Date(i)))
        : i.match(
            /^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.hda$/gi
          )
        ? ((i = i.replace(
            /^(\d{2})?(\d{2})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})-.*\.hda$/gi,
            "20$2 $3 $4 $5:$6:$7"
          )),
          (i = new Date(i)))
        : (i = null);
      let h = "",
        a = "";
      return (
        i &&
          ((h =
            i.getFullYear() + "/" + r(i.getMonth() + 1) + "/" + r(i.getDate())),
          (a =
            r(i.getHours()) +
            ":" +
            r(i.getMinutes()) +
            ":" +
            r(i.getSeconds()))),
        {
          recording: n.join(""),
          name: n.join(""),
          createDate: h,
          createTime: a,
          time: i,
          duration: 0,
          length: 0,
          signature: "0".repeat(32),
        }
      );
    }
  }),
  s.registerHandler(z, (e) => {
    let t = ((255 & e.body[0]) << 8) | (255 & e.body[1]),
      n = [],
      r = new TextDecoder("UTF-8");
    for (let i = 0, h = 2; i < t; i++) {
      let a = ((255 & e.body[h++]) << 8) | (255 & e.body[h++]),
        b = new Uint8Array(a);
      for (let y = 0; y < a; y++) b[y] = 255 & e.body[h++];
      let k = [];
      for (let y = 0; y < 6; y++) {
        let g = (255 & e.body[h++]).toString(16).toUpperCase();
        k.push(g.length == 1 ? "0" + g : g);
      }
      n.push({ name: r.decode(b), mac: k.join("-") });
    }
    return n;
  }),
  s.registerHandler(Y, (e) => {
    if (e.body.length == 0) return { status: "disconnected" };
    if (e.body[0] == 1) return { status: "disconnected" };
    let t = ((255 & e.body[1]) << 8) | (255 & e.body[2]),
      n = new TextDecoder("UTF-8"),
      r = new Uint8Array(t),
      i = 3;
    for (let a = 0; i < e.body.length && a < t; i++, a++)
      r[a] = 255 & e.body[i];
    let h = [];
    for (let a = 0; i < e.body.length && a < 6; a++) {
      let b = e.body[i++].toString(16).toUpperCase();
      h.push(b.length == 1 ? "0" + b : b);
    }
    return {
      status: "connected",
      mac: h.join("-"),
      name: n.decode(r),
      a2dp: (255 & e.body[i++]) == 1,
      hfp: (255 & e.body[i++]) == 1,
      avrcp: (255 & e.body[i++]) == 1,
      battery: parseInt(((255 & e.body[i++]) / 255) * 100),
    };
  }),
  s.registerHandler(61448, $),
  s.registerHandler(61449, $),
  s.registerHandler(10, $),
  s.registerHandler(G, $),
  s.registerHandler(J, $),
  s.registerHandler(20, $),
  s.registerHandler(U, $),
  s.registerHandler(22, (e) => {
    let t = e.body[0],
      n = "success";
    return (
      (n =
        t == 1
          ? "length-mismatch"
          : t == 2
          ? "busy"
          : t == 3
          ? "card-full"
          : t == 4
          ? "card-error"
          : String(t)),
      { code: t, result: n }
    );
  }),
  s.registerHandler(23, $),
  s.registerHandler(24, (e) => {
    let t = e.body[0],
      n = "success";
    return (
      (n =
        t == 1
          ? "length-mismatch"
          : t == 2
          ? "busy"
          : t == 3
          ? "card-full"
          : t == 4
          ? "card-error"
          : String(t)),
      { code: t, result: n }
    );
  }),
  s.registerHandler(25, $);
export { s as J };
