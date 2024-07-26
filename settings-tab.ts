import { App, PluginSettingTab, Setting, TFolder, Vault } from 'obsidian';
import AudioRecorderPlugin from './main';

export interface AudioRecorderSettings {
    recordingFormat: string;
    saveFolder: string;
    filePrefix: string;
    startStopHotkey: string;
    pauseHotkey: string;
    resumeHotkey: string;
    audioDeviceId: string;
    sampleRate: number;
    bitrate: number;
}

export const DEFAULT_SETTINGS: AudioRecorderSettings = {
    recordingFormat: 'ogg',
    saveFolder: '',
    filePrefix: 'recording',
    startStopHotkey: '',
    pauseHotkey: '',
    resumeHotkey: '',
    audioDeviceId: '',
    sampleRate: 44100,
    bitrate: 128000
}

export class AudioRecorderSettingTab extends PluginSettingTab {
    plugin: AudioRecorderPlugin;

    constructor(app: App, plugin: AudioRecorderPlugin) {
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

        new Setting(containerEl)
            .setName('Audio recorder plus')
            .setDesc('Configure the settings for the Audio Recorder Plus plugin.')
            .setHeading();

        const supportedFormats = await this.getSupportedFormats();
        new Setting(containerEl)
            .setName('Recording format')
            .setDesc('Select the audio recording format.')
            .addDropdown(dropdown => {
                supportedFormats.forEach(format => {
                    dropdown.addOption(format, format);
                });
                dropdown.setValue(this.plugin.settings.recordingFormat);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.recordingFormat = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Sample rate')
            .setDesc('Select the audio sample rate.')
            .addDropdown(dropdown => {
                const sampleRates = [8000, 16000, 22050, 44100, 48000];
                sampleRates.forEach(rate => {
                    dropdown.addOption(rate.toString(), rate.toString());
                });
                dropdown.setValue(this.plugin.settings.sampleRate.toString());
                dropdown.onChange(async (value) => {
                    this.plugin.settings.sampleRate = parseInt(value);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Save folder')
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
                text.setValue(this.plugin.settings.saveFolder);
                text.onChange(async (value) => {
                    this.plugin.settings.saveFolder = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('File naming')
            .setDesc('Use the File prefix setting to customize the naming of your audio files. ' +
                'The final file name will include this prefix followed by a timestamp. ' +
                'For example, if your prefix is "meeting", the file name will look like ' +
                '"meeting-2023-07-21T15-30-00.ogg"')
            .setHeading();

        new Setting(containerEl)
            .setName('File prefix')
            .setDesc('Set a prefix for the audio file names.')
            .addText(text => text
                .setPlaceholder('Enter file prefix')
                .setValue(this.plugin.settings.filePrefix)
                .onChange(async (value) => {
                    this.plugin.settings.filePrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Audio input')
            .setHeading();

        const audioDevices = await this.getAudioInputDevices();

        new Setting(containerEl)
            .setName('Audio input device')
            .setDesc('Select the audio input device for recording.')
            .addDropdown(dropdown => {
                audioDevices.forEach(device => {
                    dropdown.addOption(device.deviceId, device.label);
                });
                dropdown.setValue(this.plugin.settings.audioDeviceId);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.audioDeviceId = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Documentation')
            .setDesc(
                'File prefix: Customize the prefix for your audio files. ' +
                'The final file name will include this prefix followed by a timestamp.\n' +
                'Recording format: Select the format for your audio recordings. ' +
                'Available formats are OGG, WEBM, MP3, and M4A.\n' +
                'Save folder: Specify the folder where recordings will be saved. ' +
                'Auto-complete suggestions are available.\n' +
                'Audio input device: Choose which microphone to use for recording.\n' +
                'Sample rate: Select the sample rate for your audio recordings.\n' +
                'Start/Stop hotkey: Set a hotkey to quickly start and stop recordings.\n' +
                'Pause hotkey: Set a hotkey to pause recordings.\n' +
                'Resume hotkey: Set a hotkey to resume recordings.\n' +
                'Bitrate: Adjust the bitrate for your recordings to control quality and file size.\n' +
                'Visual indicators: The status bar will show when recording is active.'
            )
            .setHeading();
    }
}