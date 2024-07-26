import { App, Editor, MarkdownView, Modal, normalizePath, Notice, Plugin, Setting, TFile } from 'obsidian';
import { AudioRecorderSettingTab, AudioRecorderSettings, DEFAULT_SETTINGS } from './settings-tab';


// Modal for selecting audio input device
class SelectInputDeviceModal extends Modal {
	plugin: AudioRecorderPlugin;
	devices: MediaDeviceInfo[];

	constructor(app: App, plugin: AudioRecorderPlugin, devices: MediaDeviceInfo[]) {
		super(app);
		this.plugin = plugin;
		this.devices = devices;
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

export default class AudioRecorderPlugin extends Plugin {
	settings: AudioRecorderSettings;
	mediaRecorder: MediaRecorder | null = null;
	audioChunks: Blob[] = [];
	statusBarItemEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new AudioRecorderSettingTab(this.app, this));

		this.addCommand({
			id: 'start-stop-recording',
			name: 'Start/Stop Recording',
			callback: () => this.handleRecording()
		});

		this.addCommand({
			id: 'pause-recording',
			name: 'Pause Recording',
			callback: () => this.handlePause()
		});

		this.addCommand({
			id: 'resume-recording',
			name: 'Resume Recording',
			callback: () => this.handleResume()
		});

		this.addCommand({
			id: 'select-audio-input-device',
			name: 'Select Audio Input Device',
			callback: () => this.showSelectInputDeviceModal()
		});

		// Add ribbon icon button with "🎙️" icon
		this.addRibbonIcon('microphone', 'Start/Stop Recording', () => {
			this.handleRecording();
		});

		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar(false);
	}

	onunload() {
		this.updateStatusBar(false);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async getAudioInputDevices() {
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.filter(device => device.kind === 'audioinput');
	}

	async showSelectInputDeviceModal() {
		const devices = await this.getAudioInputDevices();
		if (devices.length === 0) {
			new Notice('No audio input devices found');
			return;
		}
		new SelectInputDeviceModal(this.app, this, devices).open();
	}

	updateStatusBar(isRecording: boolean) {
		if (this.statusBarItemEl) {
			if (isRecording) {
				this.statusBarItemEl.setText('Recording 🎙️...');
				this.statusBarItemEl.addClass('is-recording');
			} else {
				this.statusBarItemEl.setText('');
				this.statusBarItemEl.removeClass('is-recording');
			}
		}
	}

	async handleRecording() {
		const mimeType = `audio/${this.settings.recordingFormat};codecs=opus`;

		if (!MediaRecorder.isTypeSupported(mimeType)) {
			new Notice(`The format ${mimeType} is not supported in this browser.`);
			return;
		}

		if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
			this.mediaRecorder.stop();
			new Notice('Recording stopped');
			this.updateStatusBar(false);
		} else {
			try {
				const audioDevices = await this.getAudioInputDevices();
				const audioDeviceId = audioDevices.find(device => device.deviceId === this.settings.audioDeviceId)?.deviceId;

				const stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined,
						sampleRate: this.settings.sampleRate // Use the configured sample rate
					}
				});

				this.mediaRecorder = new MediaRecorder(stream, { mimeType });
				this.audioChunks = [];

				this.mediaRecorder.ondataavailable = (event) => {
					this.audioChunks.push(event.data);
				};

				this.mediaRecorder.onstop = async () => {
					try {
						const audioBlob = new Blob(this.audioChunks, { type: mimeType });
						const arrayBuffer = await audioBlob.arrayBuffer();
						const base64Audio = Buffer.from(arrayBuffer).toString('base64');

						const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
						const fileName = `${this.settings.filePrefix || 'recording'}-${timestamp}.${this.settings.recordingFormat}`;
						const sanitizedFileName = fileName.replace(/[\\/:*?"<>|]/g, '-');

						const filePath = normalizePath(this.settings.saveFolder + '/' + sanitizedFileName);

						const file = await this.app.vault.createBinary(filePath, Buffer.from(base64Audio, 'base64'));
						const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
						if (editor) {
							editor.replaceSelection(`![[${file.path}]]`);
						}
					} catch (error) {
						new Notice(`Error saving file: ${error.message}`);
					}
				};

				this.mediaRecorder.start();
				new Notice('Recording started');
				this.updateStatusBar(true);
			} catch (error) {
				new Notice(`Error accessing media devices: ${error.message}`);
			}
		}
	}

	handlePause() {
		if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
			this.mediaRecorder.pause();
			new Notice('Recording paused');
		} else {
			new Notice('No active recording to pause');
		}
	}

	handleResume() {
		if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
			this.mediaRecorder.resume();
			new Notice('Recording resumed');
		} else {
			new Notice('No paused recording to resume');
		}
	}
}
