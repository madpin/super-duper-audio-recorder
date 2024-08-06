import { App, Editor, MarkdownView, Modal, normalizePath, Notice, Plugin, Setting, TFile } from 'obsidian';
import { AudioRecorderSettingTab, AudioRecorderSettings, DEFAULT_SETTINGS } from './settings-tab';

enum RecordingStatus {
	Idle,
	Recording,
	Paused
}

class AudioRecorderPlugin extends Plugin {
	settings: AudioRecorderSettings;
	private recorders: MediaRecorder[] = [];
	private audioChunks: Blob[][] = [];
	private statusBarItem: HTMLElement | null = null;
	private recordingStatus: RecordingStatus = RecordingStatus.Idle;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AudioRecorderSettingTab(this.app, this));
		this.registerCommands();
		this.addRibbonIcon('microphone', 'Start/Stop Recording', () => this.toggleRecording());
		this.setupStatusBar();
	}

	onunload() {
		this.updateStatusBar();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerCommands() {
		this.addCommand({
			id: 'start-stop-recording',
			name: 'Start/Stop Recording',
			callback: () => this.toggleRecording()
		});
		this.addCommand({
			id: 'pause-resume-recording',
			name: 'Pause/Resume Recording',
			callback: () => this.togglePauseResume()
		});
		this.addCommand({
			id: 'select-audio-input-device',
			name: 'Select Audio Input Device',
			callback: () => this.showDeviceSelectionModal()
		});
	}

	private setupStatusBar() {
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();
	}

	private debugLog(message: string) {
		if (this.settings.debug) {
			console.log(`[AudioRecorder Debug] ${message}`);
		}
	}

	private updateStatusBar() {
		if (!this.statusBarItem) return;

		switch (this.recordingStatus) {
			case RecordingStatus.Recording:
				this.statusBarItem.setText('Recording 🎙️...');
				this.statusBarItem.addClass('is-recording');
				break;
			case RecordingStatus.Paused:
				this.statusBarItem.setText('Recording paused 🎙️');
				this.statusBarItem.addClass('is-recording');
				break;
			case RecordingStatus.Idle:
			default:
				this.statusBarItem.setText('');
				this.statusBarItem.removeClass('is-recording');
				break;
		}
	}

	private async toggleRecording() {
		if (this.recordingStatus === RecordingStatus.Idle) {
			await this.startRecording();
		} else {
			await this.stopRecording();
		}
	}

	private async startRecording() {
		try {
			const mimeType = `audio/${this.settings.recordingFormat};codecs=opus`;
			if (!MediaRecorder.isTypeSupported(mimeType)) {
				throw new Error(`The format ${mimeType} is not supported in this browser.`);
			}

			const streams = await this.getAudioStreams();
			this.recorders = streams.map(stream => new MediaRecorder(stream, { mimeType }));
			this.audioChunks = this.recorders.map(() => []);

			this.recorders.forEach((recorder, index) => {
				recorder.ondataavailable = (event) => {
					if (event.data.size > 0) {
						this.audioChunks[index].push(event.data);
					}
				};
				recorder.start();
			});

			this.recordingStatus = RecordingStatus.Recording;
			this.updateStatusBar();
			new Notice('Recording started');
		} catch (error) {
			new Notice(`Error starting recording: ${error.message}`);
			this.debug(`Error in startRecording: ${error}`);
		}
	}

	private async stopRecording() {
		try {
			await Promise.all(this.recorders.map(recorder => {
				return new Promise<void>((resolve) => {
					recorder.addEventListener('stop', () => resolve(), { once: true });
					recorder.stop();
				});
			}));

			this.recordingStatus = RecordingStatus.Idle;
			this.updateStatusBar();
			new Notice('Recording stopped');

			await this.saveRecording();
		} catch (error) {
			new Notice(`Error stopping recording: ${error.message}`);
			this.debug(`Error in stopRecording: ${error}`);
		}
	}

	private togglePauseResume() {
		if (this.recordingStatus === RecordingStatus.Recording) {
			this.recorders.forEach(recorder => recorder.pause());
			this.recordingStatus = RecordingStatus.Paused;
			new Notice('Recording paused');
		} else if (this.recordingStatus === RecordingStatus.Paused) {
			this.recorders.forEach(recorder => recorder.resume());
			this.recordingStatus = RecordingStatus.Recording;
			new Notice('Recording resumed');
		} else {
			new Notice('No active recording to pause or resume');
		}
		this.updateStatusBar();
	}

	private async getAudioStreams(): Promise<MediaStream[]> {
		const devices = await this.getAudioInputDevices();
		const streamPromises = this.settings.enableMultiTrack
			? Object.values(this.settings.trackAudioSources).map((deviceId: string) => this.getAudioStream(deviceId))
			: [this.getAudioStream(this.settings.audioDeviceId)];
		return Promise.all(streamPromises);
	}

	private async getAudioStream(deviceId?: string): Promise<MediaStream> {
		return navigator.mediaDevices.getUserMedia({
			audio: {
				deviceId: deviceId ? { exact: deviceId } : undefined,
				sampleRate: this.settings.sampleRate
			}
		});
	}

	private async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.filter(device => device.kind === 'audioinput');
	}

	private async saveRecording() {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const fileLinks: string[] = [];

		if (this.settings.outputMode === 'single') {
			const mergedAudio = await this.mergeAudioTracks();
			const fileName = `${this.settings.filePrefix}-multitrack-${timestamp}.wav`;
			const filePath = await this.saveAudioFile(mergedAudio, fileName);
			if (filePath) fileLinks.push(filePath);
		} else {
			for (let i = 0; i < this.audioChunks.length; i++) {
				const chunks = this.audioChunks[i];
				if (chunks.length === 0) continue;

				const audioBlob = new Blob(chunks, { type: `audio/${this.settings.recordingFormat}` });
				const sourceName = await this.getAudioSourceName(this.settings.trackAudioSources[i+1]);
				const fileName = `${this.settings.filePrefix}-${sourceName}-${timestamp}.${this.settings.recordingFormat}`;
				const filePath = await this.saveAudioFile(audioBlob, fileName);
				if (filePath) fileLinks.push(filePath);
			}
		}

		if (fileLinks.length > 0) {
			this.insertFileLinks(fileLinks);
			new Notice(`Saved ${fileLinks.length} audio file(s)`);
		} else {
			new Notice('No audio data recorded');
		}
	}

	private async mergeAudioTracks(): Promise<Blob> {
		const audioContext = new (window.AudioContext || window.AudioContext)();
		const buffers = await Promise.all(this.audioChunks.map(async (chunks) => {
			if (chunks.length === 0) return null;
			const blob = new Blob(chunks, { type: `audio/${this.settings.recordingFormat}` });
			const arrayBuffer = await blob.arrayBuffer();
			return audioContext.decodeAudioData(arrayBuffer);
		}));

		const validBuffers = buffers.filter((buffer): buffer is AudioBuffer => buffer !== null);
		if (validBuffers.length === 0) {
			throw new Error('No audio data recorded');
		}

		const longestDuration = Math.max(...validBuffers.map(buffer => buffer.duration));
		const offlineContext = new OfflineAudioContext(2, audioContext.sampleRate * longestDuration, audioContext.sampleRate);

		validBuffers.forEach(buffer => {
			const source = offlineContext.createBufferSource();
			source.buffer = buffer;
			source.connect(offlineContext.destination);
			source.start(0);
		});

		const renderedBuffer = await offlineContext.startRendering();
		return this.bufferToWave(renderedBuffer, renderedBuffer.length);
	}

	private bufferToWave(abuffer: AudioBuffer, len: number) {

		this.debugLog("abuffer:" + abuffer)
		this.debugLog("len:" + len)
		this.debugLog("abuffer.numberOfChannels:" + abuffer.numberOfChannels)


		const numOfChan = abuffer.numberOfChannels;
		const length = len * numOfChan * 2 + 44;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const channels = [];
		let i, sample;
		let offset = 0;
		this.debugLog(`Buffer length: ${abuffer.length}, Channels: ${numOfChan}, Sample rate: ${abuffer.sampleRate}`);

		// write WAVE header
		setUint32(0x46464952);
		setUint32(length - 8);
		setUint32(0x45564157);
		setUint32(0x20746d66);
		setUint32(16);
		setUint16(1);
		setUint16(numOfChan);
		setUint32(abuffer.sampleRate);
		setUint32(abuffer.sampleRate * 2 * numOfChan);
		setUint16(numOfChan * 2);
		setUint16(16);
		setUint32(0x61746164);
		setUint32(length - 44);

		// write interleaved data
		for (i = 0; i < abuffer.numberOfChannels; i++)
			channels.push(abuffer.getChannelData(i));

		for (offset = 0; offset < len && offset < abuffer.length; offset++) {
			for (i = 0; i < numOfChan; i++) {
				sample = Math.max(-1, Math.min(1, channels[i][offset]));
				view.setInt16(44 + offset * numOfChan * 2 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
			}
		}





		return new Blob([buffer], { type: "audio/wav" });

		function setUint16(data: number) {
			view.setUint16(offset, data, true);
			offset += 2;
		}

		function setUint32(data: number) {
			view.setUint32(offset, data, true);
			offset += 4;
		}
	}

	private async saveAudioFile(audioBlob: Blob, fileName: string): Promise<string | null> {
		if (audioBlob.size === 0) {
			this.debug(`Skipping empty file: ${fileName}`);
			return null;
		}

		const arrayBuffer = await audioBlob.arrayBuffer();
		const base64Audio = Buffer.from(arrayBuffer).toString('base64');
		let sanitizedFileName = fileName.replace(/[\\\\/:*?"<>|]/g, '-');
		let filePath = normalizePath(this.settings.saveFolder + '/' + sanitizedFileName);

		let counter = 1;
		while (await this.app.vault.adapter.exists(filePath)) {
			const parts = sanitizedFileName.split('.');
			const ext = parts.pop();
			const name = parts.join('.');
			sanitizedFileName = `${name}_${counter}.${ext}`;
			filePath = normalizePath(this.settings.saveFolder + '/' + sanitizedFileName);
			counter++;
		}

		await this.app.vault.createBinary(filePath, Buffer.from(base64Audio, 'base64'));
		return filePath;
	}

	private insertFileLinks(fileLinks: string[]) {
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (editor) {
			const links = fileLinks.map(path => `![[${path}]]`).join('\n');
			editor.replaceSelection(links);
		}
	}

	private async getAudioSourceName(deviceId: string): Promise<string> {
		const devices = await this.getAudioInputDevices();
		const device = devices.find(d => d.deviceId === deviceId);
		return device ? device.label.replace(/[^a-zA-Z0-9]/g, '') || `Device${deviceId}` : 'UnknownDevice';
	}

	private async showDeviceSelectionModal() {
		const devices = await this.getAudioInputDevices();
		if (devices.length === 0) {
			new Notice('No audio input devices found');
			return;
		}
		new SelectInputDeviceModal(this.app, this, devices).open();
	}

	private debug(message: string) {
		if (this.settings.debug) {
			console.log(`[AudioRecorder Debug] ${message}`);
		}
	}
}

class SelectInputDeviceModal extends Modal {
	constructor(app: App, private plugin: AudioRecorderPlugin, private devices: MediaDeviceInfo[]) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;

		new Setting(contentEl).setName('Select audio input device').setHeading();
		const dropdown = contentEl.createEl('select');
		this.devices.forEach(device => {
			const option = dropdown.createEl('option');
			option.value = device.deviceId;
			option.text = device.label || `Device ${device.deviceId}`;
		});

		const button = contentEl.createEl('button', { text: 'Select' });
		button.onclick = async () => {
			const selectedDeviceId = dropdown.value;
			this.plugin.settings.audioDeviceId = selectedDeviceId;
			await this.plugin.saveSettings();
			new Notice(`Selected audio device: ${dropdown.selectedOptions[0].text}`);
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export default AudioRecorderPlugin;