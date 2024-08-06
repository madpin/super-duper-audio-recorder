import { App, PluginSettingTab, Setting, TFolder, Vault, DropdownComponent } from 'obsidian';
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

    enableMultiTrack: boolean;
    maxTracks: number;
    outputMode: 'single' | 'multiple';
    useSourceNamesForTracks: boolean;
    trackAudioSources: { [key: number]: string };
    debug: boolean;
}

export const DEFAULT_SETTINGS: AudioRecorderSettings = {
    recordingFormat: 'webm',
    saveFolder: '',
    filePrefix: 'recording',
    startStopHotkey: '',
    pauseHotkey: '',
    resumeHotkey: '',
    audioDeviceId: '',
    sampleRate: 44100,
    bitrate: 128000,

    enableMultiTrack: false,
    maxTracks: 2,
    outputMode: 'single',
    useSourceNamesForTracks: true,
    trackAudioSources: {},
    debug: false
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
            .setName('Debug mode')
            .setDesc('Enable debug logging')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debug)
                .onChange(async (value) => {
                    this.plugin.settings.debug = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('Multi-track recording')
            .setDesc('Configure settings for multi-track recording.')
            .setHeading();

        new Setting(containerEl)
            .setName('Enable multi-track recording')
            .setDesc('Toggle to activate or deactivate multi-track recording.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMultiTrack)
                .onChange(async (value) => {
                    this.plugin.settings.enableMultiTrack = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh the settings page
                }));

        if (this.plugin.settings.enableMultiTrack) {
            new Setting(containerEl)
                .setName('Maximum tracks')
                .setDesc('Set the number of simultaneous tracks (1-8).')
                .addSlider(slider => slider
                    .setLimits(1, 8, 1)
                    .setValue(this.plugin.settings.maxTracks)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.maxTracks = value;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh the settings page
                    }));

            new Setting(containerEl)
                .setName('Output mode')
                .setDesc('Choose between single combined file or separate files for each track.')
                .addDropdown(dropdown => dropdown
                    .addOption('single', 'Single File')
                    .addOption('multiple', 'Multiple Files')
                    .setValue(this.plugin.settings.outputMode)
                    .onChange(async (value: 'single' | 'multiple') => {
                        this.plugin.settings.outputMode = value;
                        await this.plugin.saveSettings();
                    }));

            // new Setting(containerEl)
            //     .setName('Use source names for tracks')
            //     .setDesc('Use audio source names for individual track filenames.')
            //     .addToggle(toggle => toggle
            //         .setValue(this.plugin.settings.useSourceNamesForTracks)
            //         .onChange(async (value) => {
            //             this.plugin.settings.useSourceNamesForTracks = value;
            //             await this.plugin.saveSettings();
            //         }));

            for (let i = 1; i <= this.plugin.settings.maxTracks; i++) {
                new Setting(containerEl)
                    .setName(`Audio Source for Track ${i}`)
                    .setDesc(`Select the audio input device for track ${i}`)
                    .addDropdown(async (dropdown) => {
                        await this.populateAudioDevices(dropdown);
                        dropdown.setValue(this.plugin.settings.trackAudioSources[i] || "");
                        dropdown.onChange(async (value) => {
                            this.plugin.settings.trackAudioSources[i] = value;
                            await this.plugin.saveSettings();
                        });
                    });
            }
        }

        new Setting(containerEl)
            .setName('Documentation')
            .setDesc(
                'File Prefix: Customize the prefix for your audio files. The final filename includes this prefix and a timestamp.\n\n' +
                'Recording Format: Choose between OGG, WEBM, MP3, or M4A for your audio recordings.\n\n' +
                'Save Folder: Specify where recordings will be saved. Autocomplete suggestions are available.\n\n' +
                'Audio Input Device: Select the microphone for recording.\n\n' +
                'Sample Rate: Set the sample rate for your audio recordings.\n\n' +
                'Hotkeys:\n' +
                '- Start/Stop: Set a hotkey to quickly start and stop recordings.\n' +
                '- Pause: Set a hotkey to pause recordings.\n' +
                '- Resume: Set a hotkey to resume recordings.\n\n' +
                'Bitrate: Adjust to control quality and file size of your recordings.\n\n' +
                'Visual Indicators: The status bar displays when recording is active.\n\n' +
                'Multi-track Recording:\n' +
                '- Enable to record multiple audio sources simultaneously.\n' +
                '- Maximum Tracks: Set the number of simultaneous tracks (1-8).\n' +
                '- Output Mode: Choose between a single combined file or separate files for each track.\n' +
                '- Use Source Names: Option to use audio source names for individual track filenames.\n' +
                '- Audio Source Selection: Choose specific audio input devices for each track.'
            )
            .setHeading();
    }

    async populateAudioDevices(dropdown: DropdownComponent) {
        const devices = await this.getAudioInputDevices();
        devices.forEach(device => {
            dropdown.addOption(device.deviceId, device.label || `Audio Device ${device.deviceId}`);
        });
    }
}