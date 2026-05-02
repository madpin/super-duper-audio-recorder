import { App, Editor, MarkdownView, Modal, normalizePath, Notice, Plugin, Setting, TFile } from 'obsidian';
import { AudioRecorderSettingTab } from './settings-tab';
import { AudioRecorderSettings, DEFAULT_SETTINGS } from './settings';
import { bufferToWave } from './wav-exporter';

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
	private autoSaveTimer: number | null = null;
	private splitTimer: number | null = null;
	private recordingStartTime: number = 0;
	private currentRecordingSize: number[] = [];
	private readonly MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB threshold for automatic split

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new AudioRecorderSettingTab(this.app, this));
		this.registerCommands();
		this.addRibbonIcon('microphone', 'Start/Stop Recording', () => this.toggleRecording());
		this.setupStatusBar();
	}

	onunload() {
		this.stopTimers();
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

	private log(message: string, isError: boolean = false) {
		if (this.settings.debug || isError) {
			console.log(`[AudioRecorder${isError ? ' ERROR' : ' Debug'}] ${message}`);
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
			const isWav = this.settings.recordingFormat === 'wav';

			// If WAV, we might need a different mimeType for MediaRecorder if supported,
			// or just use default and convert at the end.
			// Actually, MediaRecorder usually doesn't support 'audio/wav' directly.
			// We'll record as webm/ogg and convert to WAV if requested at the end.
			const actualMimeType = isWav ? 'audio/webm;codecs=opus' : mimeType;

			if (!isWav && !MediaRecorder.isTypeSupported(actualMimeType)) {
				throw new Error(`The format ${actualMimeType} is not supported in this browser.`);
			}

			const streams = await this.getAudioStreams();
			this.recorders = streams.map(stream => new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported(actualMimeType) ? actualMimeType : undefined }));
			this.audioChunks = this.recorders.map(() => []);
			this.currentRecordingSize = this.recorders.map(() => 0);

			this.recorders.forEach((recorder, index) => {
				recorder.ondataavailable = (event) => {
					if (event.data.size > 0) {
						this.audioChunks[index].push(event.data);
						this.currentRecordingSize[index] += event.data.size;

						// Automatic split if file gets too large
						if (this.currentRecordingSize[index] > this.MAX_FILE_SIZE) {
							this.log(`File size threshold reached (${this.currentRecordingSize[index]} bytes). Triggering automatic split.`);
							this.splitRecording();
						}
					}
				};
				recorder.start(10000); // Collect data every 10 seconds for better data safety
			});

			this.recordingStatus = RecordingStatus.Recording;
			this.recordingStartTime = Date.now();
			this.updateStatusBar();
			this.startTimers();
			new Notice('Recording started');
		} catch (error) {
			new Notice(`Error starting recording: ${error.message}`);
			this.log(`Error in startRecording: ${error}`, true);
		}
	}

	private startTimers() {
		this.stopTimers();
		if (this.settings.autoSaveInterval > 0) {
			this.autoSaveTimer = window.setInterval(() => this.autoSave(), this.settings.autoSaveInterval * 60 * 1000);
		}
		if (this.settings.splitFileDuration > 0) {
			this.splitTimer = window.setInterval(() => this.splitRecording(), this.settings.splitFileDuration * 60 * 1000);
		}
	}

	private stopTimers() {
		if (this.autoSaveTimer) {
			clearInterval(this.autoSaveTimer);
			this.autoSaveTimer = null;
		}
		if (this.splitTimer) {
			clearInterval(this.splitTimer);
			this.splitTimer = null;
		}
	}

	private async autoSave() {
		this.log('Performing auto-save...');
		await this.saveRecording(true);
	}

	private async splitRecording() {
		this.log('Splitting recording...');
		await this.stopRecording(false);
		await this.startRecording();
	}

	private async stopRecording(showNotice: boolean = true) {
		try {
			this.stopTimers();
			await Promise.all(this.recorders.map(recorder => {
				return new Promise<void>((resolve) => {
					if (recorder.state === 'inactive') {
						resolve();
					} else {
						recorder.addEventListener('stop', () => resolve(), { once: true });
						recorder.stop();
					}
				});
			}));

			this.recordingStatus = RecordingStatus.Idle;
			this.updateStatusBar();
			if (showNotice) new Notice('Recording stopped');

			await this.saveRecording();
		} catch (error) {
			new Notice(`Error stopping recording: ${error.message}`);
			this.log(`Error in stopRecording: ${error}`, true);
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

	private async saveRecording(isAutoSave: boolean = false) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const suffix = isAutoSave ? '-autosave' : '';
		const fileLinks: string[] = [];

		if (this.settings.outputMode === 'single' && !isAutoSave) {
			try {
				const mergedAudio = await this.mergeAudioTracks();
				const fileName = `${this.settings.filePrefix}-combined-${timestamp}${suffix}.wav`;
				const filePath = await this.saveAudioFile(mergedAudio, fileName);
				if (filePath) fileLinks.push(filePath);
			} catch (e) {
				this.log(`Failed to merge tracks: ${e}`, true);
				// Fallback to saving separate tracks if merge fails
				await this.saveTracksSeparately(timestamp, suffix, fileLinks);
			}
		} else {
			await this.saveTracksSeparately(timestamp, suffix, fileLinks);
		}

		if (fileLinks.length > 0 && !isAutoSave) {
			this.insertFileLinks(fileLinks);
			new Notice(`Saved ${fileLinks.length} audio file(s)`);
		} else if (fileLinks.length === 0 && !isAutoSave) {
			new Notice('No audio data recorded');
		}
	}

	private async saveTracksSeparately(timestamp: string, suffix: string, fileLinks: string[]) {
		for (let i = 0; i < this.audioChunks.length; i++) {
			const chunks = this.audioChunks[i];
			if (chunks.length === 0) continue;

			const audioBlob = new Blob(chunks, { type: `audio/${this.settings.recordingFormat}` });
			const sourceName = await this.getAudioSourceName(this.settings.trackAudioSources[i + 1]);
			const fileName = `${this.settings.filePrefix}-${sourceName}-${timestamp}${suffix}.${this.settings.recordingFormat}`;
			const filePath = await this.saveAudioFile(audioBlob, fileName);
			if (filePath) fileLinks.push(filePath);
		}
	}

	private async mergeAudioTracks(): Promise<Blob> {
		const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
		const offlineContext = new OfflineAudioContext(2, Math.ceil(audioContext.sampleRate * longestDuration), audioContext.sampleRate);

		validBuffers.forEach(buffer => {
			const source = offlineContext.createBufferSource();
			source.buffer = buffer;
			source.connect(offlineContext.destination);
			source.start(0);
		});

		const renderedBuffer = await offlineContext.startRendering();
		return bufferToWave(renderedBuffer, renderedBuffer.length);
	}

	private async saveAudioFile(audioBlob: Blob, fileName: string): Promise<string | null> {
		if (audioBlob.size === 0) {
			this.log(`Skipping empty file: ${fileName}`);
			return null;
		}

		try {
			const arrayBuffer = await audioBlob.arrayBuffer();
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

			await this.app.vault.createBinary(filePath, arrayBuffer);
			return filePath;
		} catch (error) {
			this.log(`Error saving audio file ${fileName}: ${error}`, true);
			new Notice(`Error saving recording: ${error.message}`);
			return null;
		}
	}

	private insertFileLinks(fileLinks: string[]) {
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (editor) {
			const links = fileLinks.map(path => `![[${path}]]`).join('\n');
			editor.replaceSelection(links + '\n');
		}
	}

	private async getAudioSourceName(deviceId: string): Promise<string> {
		const devices = await this.getAudioInputDevices();
		const device = devices.find(d => d.deviceId === deviceId);
		return device ? device.label.replace(/[^a-zA-Z0-9]/g, '') || `Device${deviceId}` : 'DefaultDevice';
	}

	private async showDeviceSelectionModal() {
		const devices = await this.getAudioInputDevices();
		if (devices.length === 0) {
			new Notice('No audio input devices found');
			return;
		}
		new SelectInputDeviceModal(this.app, this, devices).open();
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
			if (device.deviceId === this.plugin.settings.audioDeviceId) {
				option.selected = true;
			}
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
