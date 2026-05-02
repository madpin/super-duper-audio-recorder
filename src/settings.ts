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

    // New settings for fixing the issues
    autoSaveInterval: number; // in minutes, 0 to disable
    splitFileDuration: number; // in minutes, 0 to disable
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
    debug: false,

    autoSaveInterval: 5,
    splitFileDuration: 0
}
