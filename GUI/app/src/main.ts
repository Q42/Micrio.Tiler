import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { upload, UserToken, login } from '@micrio/tiler-base';
import path from 'path';

import { state } from './state.js';
import { conf } from './lib/store.js';
import { getGroups } from './commands/destination.js';
import { Terminal } from './lib/terminal.js';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
	app.quit();
}

let mainWindow:BrowserWindow;

const createWindow = (): void => {
	// Create the browser window.
	mainWindow = new BrowserWindow({
		height: 600,
		width: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	mainWindow.removeMenu();

	// and load the index.html of the app.
	mainWindow.loadFile('index.html');

	// Open the DevTools.
	//mainWindow.webContents.openDevTools();

	mainWindow.webContents.executeJavaScript('localStorage.getItem("account")', true)
		.then((acct:string) => { if(acct) try {
			const parsed = JSON.parse(acct) as UserToken;
			conf.set('account', parsed);
			state.groupSlug = parsed.groupSlug;
			updateState(state.account = parsed.email);
		} catch {}}, () => {});

};

async function handleFileOpen () {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: 'Select the image(s) you want to upload',
		buttonLabel: 'Select',
		properties: ['openFile', 'multiSelections'],
		filters: [{
			name: 'Supported Micrio formats',
			extensions: ['jpg', 'webp', 'png', 'pdf', 'tif']
		}]
	});
	if(!canceled) updateState(state.files = filePaths);
}

function updateState(s?:any) {
	mainWindow.webContents.send('state', state);
}

function saveAccount(account:UserToken) : Promise<void> {
	conf.set('account', account);
	return mainWindow.webContents.executeJavaScript(`localStorage.setItem('account', '${JSON.stringify(account)}')`, true);
}

/** Logging logic */
const terminal = new Terminal(state, updateState);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
	ipcMain.on('selectFiles', () => handleFileOpen());
	ipcMain.on('login', () => login(url => updateState(state.loginUrl = url))
		.then((account:UserToken) => saveAccount(account).then(() => {
			delete state.loginUrl;
			updateState(state.account = account.email)
		}), (e) => updateState(state.error = e?.message ?? 'Unknown error'))
	);
	ipcMain.on('logout', () => {
		conf.set('account', undefined);
		delete state.groups;
		delete state.groupSlug;
		mainWindow.webContents.executeJavaScript(`localStorage.removeItem('account')`, true)
			.then(() => updateState(state.account = undefined));
	});
	ipcMain.on('start', () => {
		terminal.reset();
		state.job = {
			status: 'Starting...',
			started: Date.now(),
			numProcessed: 0,
			numUploads: 0,
			numUploaded: 0,
			bytesSource: 0,
			bytesResult: 0,
		};
		updateState();
		upload(
			state.files,
			{
				destination: state.destination!,
				format: state.format,
				type: state.type,
				pdfScale: '4'
			},{
				account: conf.get('account') as UserToken,
				log: (a, b) => terminal.log(a,b),
				job: state.job,
				update: updateState
			}
		).then(
			() => updateState(state.job.status = 'complete'),
			e => {
				console.error(e);
				updateState(state.error = 'Error: ' + (e?.message ?? 'Unknown error'));
			}
		)
	});
	ipcMain.on('reset', () => {
		state.files = [];
		state.terminal = '';
		updateState(delete state.job);
	});
	ipcMain.on('getGroups', () => getGroups().then(g => updateState(state.groups = g)));
	ipcMain.on('destination', (e, slug:string) => {
		if(slug) {
			const account = conf.get('account');
			state.groupSlug = account.groupSlug = slug.split('/')[0];
			saveAccount(account).then(() => updateState(state.destination = `https://dash.micr.io/${slug}`));
		}
		else updateState(delete state.destination);
	});
	ipcMain.on('isOmni', (e, checked:boolean) => updateState(state.type = checked ? 'omni' : '2d'));
	ipcMain.on('loaded', updateState);

	createWindow();
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});
