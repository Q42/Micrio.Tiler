import { BrowserWindow as e, app as t, dialog as n, ipcMain as r } from "electron";
import { login as i, upload as a } from "@micrio/tiler-base";
import { createRequire as o } from "node:module";
import { fileURLToPath as s } from "node:url";
import c from "path";
//#region src/lib/store.ts
var l = /* @__PURE__ */ new Map(), u = {
	account: l.get("account")?.email,
	terminal: "",
	files: [],
	type: "2d",
	format: "webp"
}, d = async () => {
	let e = l.get("account");
	if (!e?.email) throw Error("Not logged in");
	let t = await fetch("https://dash.micr.io/api/groups?includeFolders", { headers: {
		Cookie: `.AspNetCore.Identity.Application=${e.base64};`,
		"Content-Type": "application/json"
	} }).then((e) => {
		if (e.ok && e.status == 200) return e.json();
		throw Error("Error " + e.status);
	});
	if (!t) throw Error("Error getting groups");
	return t.map((e) => ({
		name: e.name,
		slug: e.slug,
		hasOmni: e.hasOmni,
		folders: f(e.folders ?? [])
	}));
}, f = (e, t) => e.filter((e) => t ? e.parentId == t : !e.parentId).map((t) => ({
	name: t.name,
	slug: t.slug,
	children: f(e, t.id)
})), p = class {
	state;
	updateState;
	lines = [];
	constructor(e, t) {
		this.state = e, this.updateState = t;
	}
	log(e = "", t = !1) {
		this.lines.length && t ? this.lines[this.lines.length - 1] = e : this.lines.push(e), this.state.terminal = this.lines.join("\n"), this.updateState?.();
	}
	reset() {
		this.lines = [];
	}
}, m = o(import.meta.url), h = c.dirname(s(import.meta.url));
m("electron-squirrel-startup") && t.quit();
var g, _ = () => {
	g = new e({
		height: 600,
		width: 800,
		webPreferences: { preload: c.join(h, "preload.mjs") }
	}), g.removeMenu(), g.loadFile("index.html"), g.webContents.executeJavaScript("localStorage.getItem(\"account\")", !0).then((e) => {
		if (e) try {
			let t = JSON.parse(e);
			l.set("account", t), u.groupSlug = t.groupSlug, y(u.account = t.email);
		} catch {}
	}, () => {});
};
async function v() {
	let { canceled: e, filePaths: t } = await n.showOpenDialog(g, {
		title: "Select the image(s) you want to upload",
		buttonLabel: "Select",
		properties: ["openFile", "multiSelections"],
		filters: [{
			name: "Supported Micrio formats",
			extensions: [
				"jpg",
				"webp",
				"png",
				"pdf",
				"tif"
			]
		}]
	});
	e || y(u.files = t);
}
function y(e) {
	g.webContents.send("state", u);
}
function b(e) {
	return l.set("account", e), g.webContents.executeJavaScript(`localStorage.setItem('account', '${JSON.stringify(e)}')`, !0);
}
var x = new p(u, y);
t.whenReady().then(() => {
	r.on("selectFiles", () => v()), r.on("login", () => i((e) => y(u.loginUrl = e)).then((e) => b(e).then(() => {
		delete u.loginUrl, y(u.account = e.email);
	}), (e) => y(u.error = e?.message ?? "Unknown error"))), r.on("logout", () => {
		l.set("account", void 0), delete u.groups, delete u.groupSlug, g.webContents.executeJavaScript("localStorage.removeItem('account')", !0).then(() => y(u.account = void 0));
	}), r.on("start", () => {
		x.reset(), u.job = {
			status: "Starting...",
			started: Date.now(),
			numProcessed: 0,
			numUploads: 0,
			numUploaded: 0,
			bytesSource: 0,
			bytesResult: 0
		}, y(), a(u.files, {
			destination: u.destination,
			format: u.format,
			type: u.type,
			pdfScale: "4"
		}, {
			account: l.get("account"),
			log: (e, t) => x.log(e, t),
			job: u.job,
			update: y
		}).then(() => y(u.job.status = "complete"), (e) => {
			console.error(e), y(u.error = "Error: " + (e?.message ?? "Unknown error"));
		});
	}), r.on("reset", () => {
		u.files = [], u.terminal = "", y(delete u.job);
	}), r.on("getGroups", () => d().then((e) => y(u.groups = e))), r.on("destination", (e, t) => {
		if (t) {
			let e = l.get("account");
			u.groupSlug = e.groupSlug = t.split("/")[0], b(e).then(() => y(u.destination = `https://dash.micr.io/${t}`));
		} else y(delete u.destination);
	}), r.on("isOmni", (e, t) => y(u.type = t ? "omni" : "2d")), r.on("loaded", y), _();
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
}), t.on("activate", () => {
	e.getAllWindows().length === 0 && _();
});
//#endregion
