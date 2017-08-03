const Statics = {
    Type: {
        AUDIO: 'audio',
        VIDEO: 'video',
        UNKNOWN: 'unknown'
    },
    BURN_IN_TIMEOUT: 30 * 1000,
    State: {
        LAUNCHING: 'launching',
        LOADING: 'loading',
        BUFFERING: 'buffering',
        PLAYING: 'playing',
        PAUSED: 'paused',
        DONE: 'done',
        IDLE: 'idle'
    },
    IDLE_TIMEOUT: {
        LAUNCHING: 1000 * 60 * 2, // 2 minutes
        LOADING: 1000 * 60 * 2, // 2 minutes
        PAUSED: 1000 * 60 * 30, // 30 minutes
        DONE: 1000 * 60 * 2, // 2 minutes
        IDLE: 1000 * 60 * 2 // 2 minutes
    },
    TRANSITION_DURATION_: 1.5,
    MEDIA_INFO_DURATION_: 3 * 1000,
    TextTrackType: {
        SIDE_LOADED_TTML: 'ttml',
        SIDE_LOADED_VTT: 'vtt',
        SIDE_LOADED_UNSUPPORTED: 'unsupported',
        EMBEDDED: 'embedded'
    },
    CaptionsMimeType: {
        TTML: 'application/ttml+xml',
        VTT: 'text/vtt'
    },
    TrackType: {
        AUDIO: 'audio',
        VIDEO: 'video',
        TEXT: 'text'
    },
    getApplicationState_: function (opt_media) {
        if (opt_media && opt_media.metadata && opt_media.metadata.title) {
            return 'Now Casting: ' + opt_media.metadata.title;
        } else if (opt_media) {
            return 'Now Casting';
        } else {
            return 'Ready To Cast';
        }
    },
    transition_: function (element, time, something) {
        if (time <= 0 || Statics.isCastForAudioDevice_()) {
            // No transitions supported for Cast for Audio devices
            something();
        } else {
            Statics.fadeOut_(element, time / 2.0, function() {
                something();
                Statics.fadeIn_(element, time / 2.0);
            });
        }
    },
    isCastForAudioDevice_: function () {
        const receiverManager = window.cast.receiver.CastReceiverManager.getInstance();
        if (receiverManager) {
            const deviceCapabilities = receiverManager.getDeviceCapabilities();
            if (deviceCapabilities) {
                return deviceCapabilities['display_supported'] === false;
            }
        }
        return false;
    },
    fadeOut_: function (element, time, opt_doneFunc) {
        Statics.fadeTo_(element, 0, time, opt_doneFunc);
    },
    fadeIn_: function (element, time, opt_doneFunc) {
        Statics.fadeTo_(element, '', time, opt_doneFunc);
    },
    fadeTo_: function (element, opacity, time, opt_doneFunc) {
        const id = Date.now();
        const listener = function() {
            element.style.webkitTransition = '';
            element.removeEventListener('webkitTransitionEnd', listener, false);
            if (opt_doneFunc) {
                opt_doneFunc();
            }
        };
        element.addEventListener('webkitTransitionEnd', listener, false);
        element.style.webkitTransition = 'opacity ' + time + 's';
        element.style.opacity = opacity;
    },
    getPath_: function (url) {
        let href = document.createElement('a');
        href.href = url;
        return href.pathname || '';
    },
    getExtension_: function (url) {
        const parts = url.split('.');
        // Handle files with no extensions and hidden files with no extension
        if (parts.length === 1 || (parts[0] === '' && parts.length === 2)) {
            return '';
        }
        return parts.pop().toLowerCase();
    },
    canDisplayPreview_: function (media) {
        const contentId = media.contentId || '';
        const contentUrlPath = Statics.getPath_(contentId);
        if (Statics.getExtension_(contentUrlPath) === 'mp4') {
            return true;
        } else if (Statics.getExtension_(contentUrlPath) === 'ogv') {
            return true;
        } else if (Statics.getExtension_(contentUrlPath) === 'webm') {
            return true;
        }
        return false;
    },
    setInnerText_: function (element, opt_text) {
        if (!element) {
            return;
        }
        element.innerText = opt_text || '';
    },
    getMediaImageUrl_: function (media) {
        const metadata = media.metadata || {};
        const images = metadata['images'] || [];
        return images && images[0] && images[0]['url'];
    },
    setBackgroundImage_: function (element, opt_url) {
        if (!element) {
            return;
        }
        element.style.backgroundImage =
            (opt_url ? 'url("' + opt_url.replace(/"/g, '\\"') + '")' : 'none');
        element.style.display = (opt_url ? '' : 'none');
    },
    getProtocolFunction_: function (mediaInformation) {
        const url = mediaInformation.contentId;
        const type = mediaInformation.contentType || '';
        const path = Statics.getPath_(url) || '';
        if (Statics.getExtension_(path) === 'm3u8' ||
            type === 'application/x-mpegurl' ||
            type === 'application/vnd.apple.mpegurl') {
            return cast.player.api.CreateHlsStreamingProtocol;
        } else if (Statics.getExtension_(path) === 'mpd' ||
            type === 'application/dash+xml') {
            return cast.player.api.CreateDashStreamingProtocol;
        } else if (path.indexOf('.ism') > -1 ||
            type === 'application/vnd.ms-sstr+xml') {
            return cast.player.api.CreateSmoothStreamingProtocol;
        }
        return null;
    },
    supportsPreload_: function (media) {
        return Statics.getProtocolFunction_(media) != null;
    },
    formatDuration_: function (dur) {
        dur = Math.floor(dur);

        function digit(n) {
            return ('00' + Math.round(n)).slice(-2);
        }
        const hr = Math.floor(dur / 3600);
        const min = Math.floor(dur / 60) % 60;
        const sec = dur % 60;
        if (!hr) {
            return digit(min) + ':' + digit(sec);
        } else {
            return digit(hr) + ':' + digit(min) + ':' + digit(sec);
        }
    },
    addClassWithTimeout_: function (element, className, timeout) {
        element.classList.add(className);
        return setTimeout(function() {
            element.classList.remove(className);
        }, timeout);
    },
    getType_: function (media) {
        const contentId = media.contentId || '';
        const contentType = media.contentType || '';
        const contentUrlPath = Statics.getPath_(contentId);
        if (contentType.indexOf('audio/') === 0) {
            return Statics.Type.AUDIO;
        } else if (contentType.indexOf('video/') === 0) {
            return Statics.Type.VIDEO;
        } else if (contentType.indexOf('application/x-mpegurl') === 0) {
            return Statics.Type.VIDEO;
        } else if (contentType.indexOf('application/vnd.apple.mpegurl') === 0) {
            return Statics.Type.VIDEO;
        } else if (contentType.indexOf('application/dash+xml') === 0) {
            return Statics.Type.VIDEO;
        } else if (contentType.indexOf('application/vnd.ms-sstr+xml') === 0) {
            return Statics.Type.VIDEO;
        } else if (Statics.getExtension_(contentUrlPath) === 'mp3') {
            return Statics.Type.AUDIO;
        } else if (Statics.getExtension_(contentUrlPath) === 'oga') {
            return Statics.Type.AUDIO;
        } else if (Statics.getExtension_(contentUrlPath) === 'wav') {
            return Statics.Type.AUDIO;
        } else if (Statics.getExtension_(contentUrlPath) === 'mp4') {
            return Statics.Type.VIDEO;
        } else if (Statics.getExtension_(contentUrlPath) === 'ogv') {
            return Statics.Type.VIDEO;
        } else if (Statics.getExtension_(contentUrlPath) === 'webm') {
            return Statics.Type.VIDEO;
        } else if (Statics.getExtension_(contentUrlPath) === 'm3u8') {
            return Statics.Type.VIDEO;
        } else if (Statics.getExtension_(contentUrlPath) === 'mpd') {
            return Statics.Type.VIDEO;
        } else if (contentType.indexOf('.ism') != 0) {
            return Statics.Type.VIDEO;
        }
        return Statics.Type.UNKNOWN;
    },
    preload_: function (media, doneFunc) {
        if (Statics.isCastForAudioDevice_()) {
            // No preloading for Cast for Audio devices
            doneFunc();
            return;
        }

        let imagesToPreload = [];
        let counter = 0;
        let images = [];

        function imageLoaded() {
            if (++counter === imagesToPreload.length) {
                doneFunc();
            }
        }

        // try to preload image metadata
        let thumbnailUrl = Statics.getMediaImageUrl_(media);
        if (thumbnailUrl) {
            imagesToPreload.push(thumbnailUrl);
        }
        if (imagesToPreload.length === 0) {
            doneFunc();
        } else {
            for (let i = 0; i < imagesToPreload.length; i++) {
                images[i] = new Image();
                images[i].src = imagesToPreload[i];
                images[i].onload = function() {
                    imageLoaded();
                };
                images[i].onerror = function() {
                    imageLoaded();
                };
            }
        }
    }
};

export default Statics;