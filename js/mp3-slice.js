/* mp3-slice.js — Découpeur ultra-léger et instantané de tranches MP3 (pure JS)
 *
 * Permet de découper une fenêtre de quelques minutes (ex: 3 min) directement
 * dans un gros ArrayBuffer MP3 (ex: 1h à 4h) sans jamais passer par le décodeur
 * complet de Web Audio API, évitant ainsi l'erreur EncodingError / OOM (2.5 Go).
 */

(function () {
  'use strict';

  // Trouve le prochain sync header MPEG frame (0xFF + bits sync)
  function findMp3FrameHeader(bytes, startOffset) {
    var len = bytes.length - 4;
    for (var i = Math.max(0, startOffset); i < len; i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) {
        var layer = (bytes[i + 1] >> 1) & 0x03;
        var bitrateIdx = (bytes[i + 2] >> 4) & 0x0F;
        var sampleRateIdx = (bytes[i + 2] >> 2) & 0x03;
        if (layer !== 0 && bitrateIdx !== 0 && bitrateIdx !== 15 && sampleRateIdx !== 3) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Extrait une tranche MP3 de `durationSec` secondes centrée sur `targetSec`
   * @param {ArrayBuffer} arrayBuffer - Buffer complet du fichier local
   * @param {number} totalDurationSec - Durée totale estimée ou mesurée du morceau (ex: audio.duration)
   * @param {number} targetSec - Position courante de lecture (secondes)
   * @param {number} [windowDurationSec=180] - Durée de la tranche voulue (défaut 3 min)
   * @returns {{ buffer: ArrayBuffer, sliceStartSec: number, sliceDurationSec: number }}
   */
  function sliceMp3Window(arrayBuffer, totalDurationSec, targetSec, windowDurationSec) {
    var winDur = windowDurationSec || 180;
    var totalDur = Math.max(1, totalDurationSec || 1);
    var bytes = new Uint8Array(arrayBuffer);
    
    // Si le fichier est court (< 10 min), on ne découpe pas
    if (totalDur <= winDur || bytes.length < 15 * 1024 * 1024) {
      return {
        buffer: arrayBuffer.slice(0),
        sliceStartSec: 0,
        sliceDurationSec: totalDur
      };
    }

    var startSec = Math.max(0, targetSec - 30);
    if (startSec + winDur > totalDur) {
      startSec = Math.max(0, totalDur - winDur);
    }

    var approxStartByte = Math.floor((startSec / totalDur) * bytes.length);
    var frameStart = findMp3FrameHeader(bytes, approxStartByte);
    if (frameStart === -1) frameStart = approxStartByte;

    var approxSliceBytes = Math.floor((winDur / totalDur) * bytes.length);
    var sliceEnd = Math.min(bytes.length, frameStart + approxSliceBytes);
    var slicedBytes = bytes.subarray(frameStart, sliceEnd);

    // Copie propre pour l'ArrayBuffer à décoder
    var copyBuf = new ArrayBuffer(slicedBytes.length);
    new Uint8Array(copyBuf).set(slicedBytes);

    var actualStartSec = (frameStart / bytes.length) * totalDur;

    return {
      buffer: copyBuf,
      sliceStartSec: actualStartSec,
      sliceDurationSec: winDur
    };
  }

  window.Mp3Slice = {
    sliceMp3Window: sliceMp3Window
  };
})();
