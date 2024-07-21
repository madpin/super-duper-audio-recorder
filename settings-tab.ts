import { App, PluginSettingTab, Setting, TFolder, Vault } from 'obsidian';
import { Plugin } from 'obsidian';

export interface AudioRecorderSettings {
    recordingFormat: string;
    saveFolder: string;
    filePrefix: string;
    startStopHotkey: string;
    pauseHotkey: string;
    resumeHotkey: string;
    audioDeviceId: string;
    sampleRate: number; // Add sampleRate to the settings interface
    bitrate: number;
}

export const DEFAULT_SETTINGS: AudioRecorderSettings = {
    recordingFormat: 'ogg',
    saveFolder: '',
    filePrefix: 'recording',
    startStopHotkey: 'Ctrl+R',
    pauseHotkey: 'Ctrl+P',
    resumeHotkey: 'Ctrl+E',
    audioDeviceId: '',
    sampleRate: 44100, // Default sample rate
    bitrate: 128000
}

export class AudioRecorderSettingTab extends PluginSettingTab {
    plugin: Plugin;

    constructor(app: App, plugin: Plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async getAudioInputDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(device => device.kind === 'audioinput');
    }

    async getSupportedFormats() {
        const formats = ['ogg', 'webm', 'mp3', 'm4a', 'mp4', 'wav'];
        const supportedFormats = formats.filter(format => MediaRecorder.isTypeSupported(`audio/${format}`));
        return supportedFormats;
    }

    getFolderOptions(): string[] {
        const folders: string[] = [];
        Vault.recurseChildren(this.app.vault.getRoot(), (file) => {
            if (file instanceof TFolder) {
                folders.push(file.path);
            }
        });
        return folders;
    }

    async display(): Promise<void> {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Audio Recorder Plus Settings' });

        containerEl.createEl('p', { text: 'Configure the settings for the Audio Recorder Plus plugin.' });

        containerEl.createEl('h3', { text: 'Recording Settings' });

        const supportedFormats = await this.getSupportedFormats();
        new Setting(containerEl)
            .setName('Recording Format')
            .setDesc('Select the audio recording format.')
            .addDropdown(dropdown => {
                supportedFormats.forEach(format => {
                    dropdown.addOption(format, format);
                });
                dropdown.setValue((this.plugin as any).settings.recordingFormat);
                dropdown.onChange(async (value) => {
                    (this.plugin as any).settings.recordingFormat = value;
                    await (this.plugin as any).saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Sample Rate')
            .setDesc('Select the audio sample rate.')
            .addDropdown(dropdown => {
                const sampleRates = [8000, 16000, 22050, 44100, 48000];
                sampleRates.forEach(rate => {
                    dropdown.addOption(rate.toString(), rate.toString());
                });
                dropdown.setValue((this.plugin as any).settings.sampleRate.toString());
                dropdown.onChange(async (value) => {
                    (this.plugin as any).settings.sampleRate = parseInt(value);
                    await (this.plugin as any).saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Save Folder')
            .setDesc('Specify the folder to save recordings. Auto-complete enabled.')
            .addText(text => {
                const folderOptions = this.getFolderOptions();
                text.inputEl.setAttribute('list', 'folder-options');
                const datalist = document.createElement('datalist');
                datalist.id = 'folder-options';
                folderOptions.forEach(folder => {
                    const option = document.createElement('option');
                    option.value = folder;
                    datalist.appendChild(option);
                });
                text.inputEl.appendChild(datalist);
                text.setValue((this.plugin as any).settings.saveFolder);
                text.onChange(async (value) => {
                    (this.plugin as any).settings.saveFolder = value;
                    await (this.plugin as any).saveSettings();
                });
            });

        containerEl.createEl('h3', { text: 'File Naming' });

        const fileNamingDesc = containerEl.createEl('p');
        fileNamingDesc.innerHTML = `
            <small>
                Use the <b>File Prefix</b> setting to customize the naming of your audio files. The final file name will include this prefix followed by a timestamp.<br>
                For example, if your prefix is <code>meeting</code>, the file name will look like <code>meeting-2023-07-21T15-30-00.ogg</code>.
            </small>
        `;

        new Setting(containerEl)
            .setName('File Prefix')
            .setDesc('Set a prefix for the audio file names.')
            .addText(text => text
                .setPlaceholder('Enter file prefix')
                .setValue((this.plugin as any).settings.filePrefix)
                .onChange(async (value) => {
                    (this.plugin as any).settings.filePrefix = value;
                    await (this.plugin as any).saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Audio Input Device' });

        const audioDevices = await this.getAudioInputDevices();

        new Setting(containerEl)
            .setName('Audio Input Device')
            .setDesc('Select the audio input device for recording.')
            .addDropdown(dropdown => {
                audioDevices.forEach(device => {
                    dropdown.addOption(device.deviceId, device.label);
                });
                dropdown.setValue((this.plugin as any).settings.audioDeviceId);
                dropdown.onChange(async (value) => {
                    (this.plugin as any).settings.audioDeviceId = value;
                    await (this.plugin as any).saveSettings();
                });
            });

        containerEl.createEl('h3', { text: 'Documentation' });

        const docDesc = containerEl.createEl('p');
        docDesc.innerHTML = `
            <small>
                <b>File Prefix:</b> Customize the prefix for your audio files. The final file name will include this prefix followed by a timestamp.<br>
                <b>Recording Format:</b> Select the format for your audio recordings. Available formats are OGG, WEBM, MP3, and M4A.<br>
                <b>Save Folder:</b> Specify the folder where recordings will be saved. Auto-complete suggestions are available.<br>
                <b>Audio Input Device:</b> Choose which microphone to use for recording.<br>
                <b>Sample Rate:</b> Select the sample rate for your audio recordings.<br>
                <b>Start/Stop Hotkey:</b> Set a hotkey to quickly start and stop recordings.<br>
                <b>Pause Hotkey:</b> Set a hotkey to pause recordings.<br>
                <b>Resume Hotkey:</b> Set a hotkey to resume recordings.<br>
                <b>Bitrate:</b> Adjust the bitrate for your recordings to control quality and file size.<br>
                <b>Visual Indicators:</b> The status bar will show when recording is active.
            </small>
        `;

        containerEl.createEl('hr');
    }
}
