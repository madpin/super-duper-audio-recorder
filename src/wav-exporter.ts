export function bufferToWave(abuffer: AudioBuffer, len: number): Blob {
    const numOfChan = abuffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i, sample;
    let offset = 0;

    function setUint16(data: number) {
        view.setUint16(offset, data, true);
        offset += 2;
    }

    function setUint32(data: number) {
        view.setUint32(offset, data, true);
        offset += 4;
    }

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);         // length = 16
    setUint16(1);          // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);         // 16nd-bit
    setUint32(0x61746164); // "data" - chunk
    setUint32(length - 44); // chunk length

    // write interleaved data
    for (i = 0; i < abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    for (let sampleOffset = 0; sampleOffset < len && sampleOffset < abuffer.length; sampleOffset++) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][sampleOffset]));
            view.setInt16(44 + sampleOffset * numOfChan * 2 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        }
    }

    return new Blob([buffer], { type: "audio/wav" });
}
