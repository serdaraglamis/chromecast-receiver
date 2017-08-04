import Logger from './logger'
import Statics from './statics'

class Receiver {
    videoElement;
    type_;
    state_;
    lastStateTransitionTime_ = 0;
    burnInPreventionIntervalId_;
    idleTimerId_;
    seekingTimerId_;
    setStateDelayTimerId_;
    currentApplicationState_;
    player_ = null;
    preloadPlayer_ = null;
    textTrackType_ = null;
    allTracks = null;
    playerAutoPlay_ = false;
    displayPreviewMode_ = false;
    deferredPlayCallbackId_ = null;
    playerReady_ = false;
    metadataLoaded_ = false;

    // Check if element exists initially TODO
    constructor(element, config) {
        this.appConfig = config;
        Logger.addLog('castPlayer');
        Logger.loggerEnabled = this.appConfig.debug;

        if (Logger.loggerEnabled) {
            cast.player.api.setLoggerLevel(cast.player.api.LoggerLevel.DEBUG);
            cast.receiver.logger.setLevelValue(cast.receiver.LoggerLevel.DEBUG);
        }
        this.videoElement = element;
        this.initCastRelatedComponents();
        this.setType_(Statics.Type.UNKNOWN, false);
        this.setState_(Statics.State.LAUNCHING, false);
        this.initUIComponents();
        this.bufferingHandler_ = this.onBuffering_.bind(this);

    }

    initCastRelatedComponents() {
        this.mediaManager_ = new cast.receiver.MediaManager(this.mediaElement_);
        this.receiverManager_ = cast.receiver.CastReceiverManager.getInstance();
        this.receiverManager_.onReady = this.onReady_.bind(this);
        this.receiverManager_.onSenderDisconnected =
            this.onSenderDisconnected_.bind(this);
        this.receiverManager_.onVisibilityChanged =
            this.onVisibilityChanged_.bind(this);
        this.receiverManager_.setApplicationState(
            Statics.getApplicationState_());
        this.mediaElement_ = /** @type {HTMLMediaElement} */
            (this.videoElement.querySelector('video'));
        this.mediaManager_ = new cast.receiver.MediaManager(this.mediaElement_);
        this.onLoadOrig_ =
            this.mediaManager_.onLoad.bind(this.mediaManager_);
        this.mediaManager_.onLoad = this.onLoad_.bind(this);
        this.onEditTracksInfoOrig_ =
            this.mediaManager_.onEditTracksInfo.bind(this.mediaManager_);
        this.mediaManager_.onEditTracksInfo = this.onEditTracksInfo_.bind(this);

        this.onMetadataLoadedOrig_ =
            this.mediaManager_.onMetadataLoaded.bind(this.mediaManager_);
        this.mediaManager_.onMetadataLoaded = this.onMetadataLoaded_.bind(this);

        this.onStopOrig_ =
            this.mediaManager_.onStop.bind(this.mediaManager_);
        this.mediaManager_.onStop = this.onStop_.bind(this);

        this.onLoadMetadataErrorOrig_ =
            this.mediaManager_.onLoadMetadataError.bind(this.mediaManager_);
        this.mediaManager_.onLoadMetadataError = this.onLoadMetadataError_.bind(this);


        this.onErrorOrig_ =
            this.mediaManager_.onError.bind(this.mediaManager_);
        this.mediaManager_.onError = this.onError_.bind(this);

        this.mediaManager_.customizedStatusCallback =
            this.customizedStatusCallback_.bind(this);

        this.mediaManager_.onPreload = this.onPreload_.bind(this);
        this.mediaManager_.onCancelPreload = this.onCancelPreload_.bind(this);
        this.mediaElement_.addEventListener('error', this.onError_.bind(this), false);
        this.mediaElement_.addEventListener('playing', this.onPlaying_.bind(this),
            false);
        this.mediaElement_.addEventListener('pause', this.onPause_.bind(this), false);
        this.mediaElement_.addEventListener('ended', this.onEnded_.bind(this), false);
        this.mediaElement_.addEventListener('abort', this.onAbort_.bind(this), false);
        this.mediaElement_.addEventListener('timeupdate', this.onProgress_.bind(this),
            false);
        this.mediaElement_.addEventListener('seeking', this.onSeekStart_.bind(this),
            false);
        this.mediaElement_.addEventListener('seeked', this.onSeekEnd_.bind(this),
            false);

    }

    initUIComponents() {
        this.progressBarInnerElement_ = this.getElementByClass_(
            '.controls-progress-inner');
        this.progressBarThumbElement_ = this.getElementByClass_(
            '.controls-progress-thumb');
        this.curTimeElement_ = this.getElementByClass_('.controls-cur-time');
        this.totalTimeElement_ = this.getElementByClass_('.controls-total-time');
        this.previewModeTimerElement_ = this.getElementByClass_('.preview-mode-timer-countdown');

    }

    onReady_() {
        Logger.addLog('onReady');
        this.setState_(Statics.State.IDLE, false);
    }

    onSenderDisconnected_(event) {
        Logger.addLog('onSenderDisconnected');
        // When the last or only sender is connected to a receiver,
        // tapping Disconnect stops the app running on the receiver.
        if (this.receiverManager_.getSenders().length === 0 &&
            event.reason ===
            cast.receiver.system.DisconnectReason.REQUESTED_BY_SENDER) {
            this.receiverManager_.stop();
        }
    }

    setType_(type, isLiveStream) {
        Logger.addLog(`setType: ${type}`);
        this.type_ = type;
        this.videoElement.setAttribute('type', type);
        this.videoElement.setAttribute('live', isLiveStream.toString());

        let overlay = this.getElementByClass_('.overlay');
        let watermark = this.getElementByClass_('.watermark');
        clearInterval(this.burnInPreventionIntervalId_);
        if (type != Statics.Type.AUDIO) {
            overlay.removeAttribute('style');
        } else {
            // if we are in 'audio' mode float metadata around the screen to
            // prevent screen burn
            this.burnInPreventionIntervalId_ = setInterval(function () {
                overlay.style.marginBottom = Math.round(Math.random() * 100) + 'px';
                overlay.style.marginLeft = Math.round(Math.random() * 600) + 'px';
            }, Statics.BURN_IN_TIMEOUT);
        }
    }

    setState_(state, opt_crossfade, opt_delay) {
        Logger.addLog('setState_: state=' + state + ', crossfade=' + opt_crossfade +
            ', delay=' + opt_delay);
        let self = this;
        this.lastStateTransitionTime_ = Date.now();
        clearTimeout(self.delay_);
        if (opt_delay) {
            let func = function () {
                this.setState_(state, opt_crossfade);
            };
            this.delay_ = setTimeout(func, opt_delay);
        } else {
            if (!opt_crossfade) {
                this.state_ = state;
                this.videoElement.setAttribute('state', state);
                this.updateApplicationState_();
                this.setIdleTimeout_(Statics.IDLE_TIMEOUT[state.toUpperCase()]);
            } else {
                const stateTransitionTime = this.lastStateTransitionTime_;
                Statics.transition_(self.element_, Statics.TRANSITION_DURATION_,
                    function () {
                        // In the case of a crossfade transition, the transition will be completed
                        // even if setState is called during the transition.  We need to be sure
                        // that the requested state is ignored as the latest setState call should
                        // take precedence.
                        if (stateTransitionTime < self.lastStateTransitionTime_) {
                            Logger.addLog('discarded obsolete deferred state(' + state + ').');
                            return;
                        }
                        self.setState_(state, false);
                    });
            }
        }
    }

    updateApplicationState_() {
        Logger.addLog('updateApplicationState_');
        if (this.mediaManager_) {
            const idle = this.state_ === Statics.State.IDLE;
            const media = idle ? null : this.mediaManager_.getMediaInformation();
            const applicationState = Statics.getApplicationState_(media);
            if (this.currentApplicationState_ != applicationState) {
                this.currentApplicationState_ = applicationState;
                this.receiverManager_.setApplicationState(applicationState);
            }
        }
    }

    getElementByClass_(className) {
        const element = this.videoElement.querySelector(className);
        if (element) {
            return element;
        } else {
            throw Error('Cannot find element with class: ' + className);
        }
    }

    onBuffering_() {
        Logger.addLog('onBuffering[readyState=' + this.mediaElement_.readyState + ']');
        if (this.state_ === Statics.State.PLAYING &&
            this.mediaElement_.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
            this.setState_(Statics.State.BUFFERING, false);
        }
    }

    customizedStatusCallback_(mediaStatus) {
        Logger.addLog('customizedStatusCallback_: playerState=' +
            mediaStatus.playerState + ', this.state_=' + this.state_);
        // TODO: remove this workaround once MediaManager detects buffering
        // immediately.
        if (mediaStatus.playerState === cast.receiver.media.PlayerState.PAUSED &&
            this.state_ === Statics.State.BUFFERING) {
            mediaStatus.playerState = cast.receiver.media.PlayerState.BUFFERING;
        }
        return mediaStatus;
    }

    onError_(error) {
        Logger.addLog('onError');
        let self = this;
        Statics.transition_(self.videoElement, Statics.TRANSITION_DURATION_,
            function() {
                self.setState_(Statics.State.IDLE, true);
                self.onErrorOrig_(error);
            });
    }

    onPreload_(evet) {
        Logger.addLog('onPreload_');
        const loadRequestData =
            /** @type {!cast.receiver.MediaManager.LoadRequestData} */
            (event.data);
        return this.preload(loadRequestData.media);
    }

    preload(mediaInformation) {
        Logger.addLog('preload');
        // For video formats that cannot be preloaded (mp4...), display preview UI.
        if (Statics.canDisplayPreview_(mediaInformation || {})) {
            this.showPreviewMode_(mediaInformation);
            return true;
        }
        if (!Statics.supportsPreload_(mediaInformation || {})) {
            Logger.addLog('preload: no supportsPreload_');
            return false;
        }
        if (this.preloadPlayer_) {
            this.preloadPlayer_.unload();
            this.preloadPlayer_ = null;
        }
        // Only videos are supported for now
        let couldPreload = this.preloadVideo_(mediaInformation);
        if (couldPreload) {
            this.showPreviewMode_(mediaInformation);
        }
        Logger.addLog('preload: couldPreload=' + couldPreload);
        return couldPreload;
    }

    showPreviewMode_(mediaInformation) {
        this.displayPreviewMode_ = true;
        this.loadPreviewModeMetadata_(mediaInformation);
        this.showPreviewModeMetadata(true);
    }

    loadPreviewModeMetadata_(media) {
        Logger.addLog('loadPreviewModeMetadata_');
        if (!Statics.isCastForAudioDevice_()) {
            const metadata = media.metadata || {};
            const titleElement = this.videoElement.querySelector('.preview-mode-title');
            Statics.setInnerText_(titleElement, metadata.title);

            const subtitleElement = this.videoElement.querySelector('.preview-mode-subtitle');
            Statics.setInnerText_(subtitleElement, metadata.subtitle);

            const artwork = Statics.getMediaImageUrl_(media);
            if (artwork) {
                const artworkElement = this.videoElement.querySelector('.preview-mode-artwork');
                Statics.setBackgroundImage_(artworkElement, artwork);
            }
        }
    }

    showPreviewModeMetadata(show) {
        this.videoElement.setAttribute('preview-mode', show.toString());
    }

    preloadVideo_(mediaInformation) {
        Logger.addLog('preloadVideo_');
        let self = this;
        const url = mediaInformation.contentId;
        const protocolFunc = Statics.getProtocolFunction_(mediaInformation);
        if (!protocolFunc) {
            Logger.addLog('No protocol found for preload');
            return false;
        }
        let host = new cast.player.api.Host({
            'url': url,
            'mediaElement': self.mediaElement_
        });
        host.onError = function() {
            self.preloadPlayer_.unload();
            self.preloadPlayer_ = null;
            self.showPreviewModeMetadata(false);
            self.displayPreviewMode_ = false;
            Logger.addLog('Error during preload');
        };
        self.preloadPlayer_ = new cast.player.api.Player(host);
        self.preloadPlayer_.preload(protocolFunc(host));
        return true;
    }

    onCancelPreload_(event) {
        Logger.addLog('onCancelPreload_');
        this.hidePreviewMode_();
        return true;
    }

    hidePreviewMode_() {
        this.showPreviewModeMetadata(false);
        this.displayPreviewMode_ = false;
    }

    onPlaying_() {
        Logger.addLog('onPlaying');
        this.cancelDeferredPlay_('media is already playing');
        const isAudio = this.type_ == Statics.Type.AUDIO;
        const isLoading = this.state_ == Statics.State.LOADING;
        const crossfade = isLoading && !isAudio;
        this.setState_(Statics.State.PLAYING, crossfade);
    }

    cancelDeferredPlay_(cancelReason) {
        if (this.deferredPlayCallbackId_) {
            Logger.addLog('Cancelled deferred playback: ' + cancelReason);
            clearTimeout(this.deferredPlayCallbackId_);
            this.deferredPlayCallbackId_ = null;
        }
    }

    onPause_() {
        Logger.addLog('onPause');
        this.cancelDeferredPlay_('media is paused');
        const isIdle = this.state_ === Statics.State.IDLE;
        const isDone = this.mediaElement_.currentTime === this.mediaElement_.duration;
        const isUnderflow = this.player_ && this.player_.getState()['underflow'];
        if (isUnderflow) {
            Logger.addLog('isUnderflow');
            this.setState_(Statics.State.BUFFERING, false);
            this.mediaManager_.broadcastStatus( /* includeMedia */ false);
        } else if (!isIdle && !isDone) {
            this.setState_(Statics.State.PAUSED, false);
        }
        this.updateProgress_();
    }

    updateProgress_() {
        if (!Statics.isCastForAudioDevice_()) {
            const curTime = this.mediaElement_.currentTime;
            const totalTime = this.mediaElement_.duration;
            if (!isNaN(curTime) && !isNaN(totalTime)) {
                const pct = 100 * (curTime / totalTime);
                this.curTimeElement_.innerText = Statics.formatDuration_(curTime);
                this.totalTimeElement_.innerText = Statics.formatDuration_(totalTime);
                this.progressBarInnerElement_.style.width = pct + '%';
                this.progressBarThumbElement_.style.left = pct + '%';
                // Handle preview mode
                if (this.displayPreviewMode_) {
                    this.previewModeTimerElement_.innerText = "" + Math.round(totalTime - curTime);
                }
            }
        }
    }

    onEnded_() {
        Logger('onEnded');
        this.setState_(Statics.State.IDLE, true);
        this.hidePreviewMode_();
    }

    onAbort_() {
        Logger.addLog('onAbort');
        this.setState_(Statics.State.IDLE, true);
        this.hidePreviewMode_();
    }

    onProgress_() {
        // if we were previously buffering, update state to playing
        if (this.state_ === Statics.State.BUFFERING ||
            this.state_ === Statics.State.LOADING) {
            this.setState_(Statics.State.PLAYING, false);
        }
        this.updateProgress_();
    }

    onSeekStart_() {
        Logger.addLog('onSeekStart');
        clearTimeout(this.seekingTimeoutId_);
        this.videoElement.classList.add('seeking');
    }

    onSeekEnd_() {
        Logger.addLog('onSeekEnd');
        clearTimeout(this.seekingTimeoutId_);
        this.seekingTimeoutId_ = Statics.addClassWithTimeout_(this.videoElement,
            'seeking', 3000);
    }

    onVisibilityChanged_(event) {
        Logger.addLog('onVisibilityChanged');
        if (!event.isVisible) {
            this.mediaElement_.pause();
            this.mediaManager_.broadcastStatus(false);
        }
    }

    onLoad_(event) {
        Logger.addLog('onLoad_');
        this.cancelDeferredPlay_('new media is loaded');
        this.load(new cast.receiver.MediaManager.LoadInfo(
            /** @type {!cast.receiver.MediaManager.LoadRequestData} */
            (event.data),
            event.senderId));
    }

    load(info) {
        Logger.addLog('onLoad_');
        clearTimeout(this.idleTimerId_);
        let self = this;
        const media = info.message.media || {};
        const contentType = media.contentType;
        const playerType = Statics.getType_(media);
        const isLiveStream = media.streamType === cast.receiver.media.StreamType.LIVE;

        this.allTracks = media.tracks;
        if (!media.contentId) {
            Logger('Load failed: no content');
            self.onLoadMetadataError_(info);
        } else if (playerType === Statics.Type.UNKNOWN) {
            this.log_('Load failed: unknown content type: ' + contentType);
            self.onLoadMetadataError_(info);
        } else {
            Logger.addLog('Loading: ' + playerType);
            self.resetMediaElement_();
            self.setType_(playerType, isLiveStream);
            let preloaded = false;
            switch (playerType) {
                case Statics.Type.AUDIO:
                    self.loadAudio_(info);
                    break;
                case Statics.Type.VIDEO:
                    preloaded = self.loadVideo_(info);
                    break;
            }
            self.playerReady_ = false;
            self.metadataLoaded_ = false;
            self.loadMetadata_(media);
            self.showPreviewModeMetadata(false);
            self.displayPreviewMode_ = false;
            Statics.preload_(media, function() {
                Logger.addLog('preloaded=' + preloaded);
                if (preloaded) {
                    // Data is ready to play so transiton directly to playing.
                    self.setState_(Statics.State.PLAYING, false);
                    self.playerReady_ = true;
                    self.maybeSendLoadCompleted_(info);
                    // Don't display metadata again, since autoplay already did that.
                    self.deferPlay_(0);
                    self.playerAutoPlay_ = false;
                } else {
                    Statics.transition_(self.videoElement, Statics.TRANSITION_DURATION_, function() {
                        self.setState_(Statics.State.LOADING, false);
                        // Only send load completed after we reach this point so the media
                        // manager state is still loading and the sender can't send any PLAY
                        // messages
                        self.playerReady_ = true;
                        self.maybeSendLoadCompleted_(info);
                        if (self.playerAutoPlay_) {
                            // Make sure media info is displayed long enough before playback
                            // starts.
                            self.deferPlay_(Statics.MEDIA_INFO_DURATION_);
                            self.playerAutoPlay_ = false;
                        }
                    });
                }
            });
        }
    }

    onLoadMetadataError_(event) {
        Logger.addLog('onLoadMetadataError_');
        let self = this;
        Statics.transition_(self.videoElement, Statics.TRANSITION_DURATION_,
            function() {
                self.setState_(Statics.State.IDLE, true);
                self.onLoadMetadataErrorOrig_(event);
            });
    }

    resetMediaElement_() {
        Logger.addLog('resetMediaElement_');
        if (this.player_) {
            this.player_.unload();
            this.player_ = null;
        }
        this.textTrackType_ = null;
    }

    loadAudio_(info) {
        Logger.addLog('loadAudio_');
        this.letPlayerHandleAutoPlay_(info);
        this.loadDefault_(info);
    }

    letPlayerHandleAutoPlay_(info) {
        Logger.addLog('letPlayerHandleAutoPlay_: ' + info.message.autoplay);
        const autoplay = info.message.autoplay;
        info.message.autoplay = false;
        this.mediaElement_.autoplay = false;
        this.playerAutoPlay_ = autoplay == undefined ? true : autoplay;
    }

    loadDefault_(info) {
        this.onLoadOrig_(new cast.receiver.MediaManager.Event(
            cast.receiver.MediaManager.EventType.LOAD,
            /** @type {!cast.receiver.MediaManager.RequestData} */
            (info.message),
            info.senderId));
    }

    loadVideo_(info) {
        Logger.addLog('loadVideo_');
        let self = this;
        let protocolFunc = null;
        const url = info.message.media.contentId;
        protocolFunc = Statics.getProtocolFunction_(info.message.media);
        let wasPreloaded = false;
        const mCustomData = info.message.media.customData;

        this.letPlayerHandleAutoPlay_(info);
        if (!protocolFunc) {
            Logger.addLog('loadVideo_: using MediaElement');
            this.mediaElement_.addEventListener('stalled', this.bufferingHandler_,
                false);
            this.mediaElement_.addEventListener('waiting', this.bufferingHandler_,
                false);
        } else {
            Logger.addLog('loadVideo_: using Media Player Library');
            // When MPL is used, buffering status should be detected by
            // getState()['underflow]'
            this.mediaElement_.removeEventListener('stalled', this.bufferingHandler_);
            this.mediaElement_.removeEventListener('waiting', this.bufferingHandler_);

            // If we have not preloaded or the content preloaded does not match the
            // content that needs to be loaded, perform a full load
            var loadErrorCallback = function() {
                // unload player and trigger error event on media element
                if (self.player_) {
                    self.resetMediaElement_();
                    self.mediaElement_.dispatchEvent(new Event('error'));
                }
            };
            if (!this.preloadPlayer_ || (this.preloadPlayer_.getHost &&
                this.preloadPlayer_.getHost().url != url)) {
                if (this.preloadPlayer_) {
                    this.preloadPlayer_.unload();
                    this.preloadPlayer_ = null;
                }
                Logger.addLog('Regular video load');
                const host = new cast.player.api.Host({
                    'url': url,
                    'mediaElement': this.mediaElement_
                });

                if (info.message.media.contentType === "application/dash+xml") {
                    host.licenseUrl = self.appConfig.drm.widevine;
                }

                host.onError = loadErrorCallback;
                this.player_ = new cast.player.api.Player(host);
                this.player_.load(protocolFunc(host));
            } else {
                Logger.addLog('Preloaded video load');
                this.player_ = this.preloadPlayer_;
                this.preloadPlayer_ = null;
                // Replace the "preload" error callback with the "load" error callback
                this.player_.getHost().onError = loadErrorCallback;
                this.player_.load();
                wasPreloaded = true;
            }
        }
        this.loadMediaManagerInfo_(info, !!protocolFunc);
        return wasPreloaded;
    }

    loadMediaManagerInfo_(info, loadOnlyTracksMetadata) {
        Logger.addLog("loadMediaManagerInfo_");

        if (loadOnlyTracksMetadata) {
            // In the case of media that uses MPL we do not
            // use the media manager default onLoad API but we still need to load
            // the tracks metadata information into media manager (so tracks can be
            // managed and properly reported in the status messages) if they are
            // provided in the info object (side loaded).
            this.maybeLoadSideLoadedTracksMetadata_(info);
        } else {
            // Media supported by mediamanager, use the media manager default onLoad API
            // to load the media, tracks metadata and, if the tracks are vtt the media
            // manager will process the cues too.
            this.loadDefault_(info);
        }
    }

    maybeLoadSideLoadedTracksMetadata_(info) {
        // If there are no tracks we will not load the tracks information here as
        // we are likely in a embedded captions scenario and the information will
        // be loaded in the onMetadataLoaded_ callback
        if (!info.message || !info.message.media || !info.message.media.tracks ||
            info.message.media.tracks.length == 0) {
            return;
        }

        if(!info.message.media.textTrackStyle){
            info.message.media.textTrackStyle = {
                backgroundColor:'#FFFFFF00'
            }
        }
        else info.message.media.textTrackStyle.backgroundColor = '#FFFFFF00';

        const tracksInfo = /** @type {cast.receiver.media.TracksInfo} **/ ({
            tracks: info.message.media.tracks,
            activeTrackIds: info.message.activeTrackIds,
            textTrackStyle: info.message.media.textTrackStyle
        });
        this.mediaManager_.loadTracksInfo(tracksInfo);
    }

    loadMetadata_(media) {
        Logger.addLog('loadMetadata_');
        if (!Statics.isCastForAudioDevice_()) {
            const metadata = media.metadata || {};
            const titleElement = this.videoElement.querySelector('.media-title');
            Statics.setInnerText_(titleElement, metadata.title);

            const subtitleElement = this.videoElement.querySelector('.media-subtitle');
            Statics.setInnerText_(subtitleElement, metadata.subtitle);

            const artwork = Statics.getMediaImageUrl_(media);
            if (artwork) {
                const artworkElement = this.videoElement.querySelector('.media-artwork');
                Statics.setBackgroundImage_(artworkElement, artwork);
            }
        }
    }

    maybeSendLoadCompleted_(info) {
        Logger.addLog("maybeSendLoadCompleted_");
        if (!this.playerReady_) {
            Logger.addLog('Deferring load response, player not ready');
        } else if (!this.metadataLoaded_) {
            Logger.addLog('Deferring load response, loadedmetadata event not received');
        } else {
            this.onMetadataLoadedOrig_(info);
            Logger.addLog('Sent load response, player is ready and metadata loaded');
        }
    }

    deferPlay_(timeout) {
        Logger.addLog('Defering playback for ' + timeout + ' ms');
        let self = this;
        this.deferredPlayCallbackId_ = setTimeout(function() {
            self.deferredPlayCallbackId_ = null;
            if (self.player_) {
                Logger.addLog('Playing when enough data');
                self.player_.playWhenHaveEnoughData();
            } else {
                Logger.addLog('Playing');
                self.mediaElement_.play();
            }
        }, timeout);
    }

    onMetadataLoaded_(info) {
        Logger.addLog('onMetadataLoaded');
        this.onLoadSuccess_();
        // In the case of ttml and embedded captions we need to load the cues using
        // MPL.
        this.readSideLoadedTextTrackType_(info);
        if (this.textTrackType_ ==
            Statics.TextTrackType.SIDE_LOADED_TTML &&
            info.message && info.message.activeTrackIds && info.message.media &&
            info.message.media.tracks) {
            this.processTtmlCues_(
                info.message.activeTrackIds, info.message.media.tracks);
        } else if (!this.textTrackType_) {
            // If we do not have a textTrackType, check if the tracks are embedded
            this.maybeLoadEmbeddedTracksMetadata_(info);
        }
        // Only send load completed when we have completed the player LOADING state
        this.metadataLoaded_ = true;
        this.maybeSendLoadCompleted_(info);
    }

    onLoadSuccess_() {
        Logger.addLog('onLoadSuccess');
        // we should have total time at this point, so update the label
        // and progress bar
        const totalTime = this.mediaElement_.duration;
        if (!isNaN(totalTime)) {
            this.totalTimeElement_.textContent =
                Statics.formatDuration_(totalTime);
        } else {
            this.totalTimeElement_.textContent = '';
            this.progressBarInnerElement_.style.width = '100%';
            this.progressBarThumbElement_.style.left = '100%';
        }
    }

    readSideLoadedTextTrackType_(info) {
        if (!info.message || !info.message.media || !info.message.media.tracks) {
            return;
        }
        for (let i = 0; i < info.message.media.tracks.length; i++) {
            let oldTextTrackType = this.textTrackType_;
            if (info.message.media.tracks[i].type !=
                cast.receiver.media.TrackType.TEXT) {
                continue;
            }
            if (this.isTtmlTrack_(info.message.media.tracks[i])) {
                this.textTrackType_ =
                    Statics.TextTrackType.SIDE_LOADED_TTML;
            } else if (this.isVttTrack_(info.message.media.tracks[i])) {
                this.textTrackType_ =
                    Statics.TextTrackType.SIDE_LOADED_VTT;
            } else {
                Logger.addLog('Unsupported side loaded text track types');
                this.textTrackType_ =
                    Statics.TextTrackType.SIDE_LOADED_UNSUPPORTED;
                break;
            }
            // We do not support text tracks with different caption types for a single
            // piece of content
            if (oldTextTrackType && oldTextTrackType != this.textTrackType_) {
                Logger.addLog('Load has inconsistent text track types');
                this.textTrackType_ =
                    Statics.TextTrackType.SIDE_LOADED_UNSUPPORTED;
                break;
            }
        }
    }

    isVttTrack_(track) {
        return this.isKnownTextTrack_(track,
            Statics.TextTrackType.SIDE_LOADED_VTT,
            Statics.CaptionsMimeType.VTT);
    }

    processTtmlCues_(activeTrackIds, tracks) {
        if (activeTrackIds.length == 0) {
            return;
        }
        // If there is an active text track, that is using ttml, apply it
        for (let i = 0; i < tracks.length; i++) {
            let contains = false;
            for (let j = 0; j < activeTrackIds.length; j++) {
                if (activeTrackIds[j] == tracks[i].trackId) {
                    contains = true;
                    break;
                }
            }
            if (!contains ||
                !this.isTtmlTrack_(tracks[i])) {
                continue;
            }
            if (!this.player_) {
                // We do not have a player, it means we need to create it to support
                // loading ttml captions
                let host = new cast.player.api.Host({
                    'url': '',
                    'mediaElement': this.mediaElement_
                });
                this.protocol_ = null;
                this.player_ = new cast.player.api.Player(host);
            }
            this.player_.enableCaptions(
                true, cast.player.api.CaptionsType.TTML, tracks[i].trackContentId);
        }
    }

    isTtmlTrack_(track) {
        return this.isKnownTextTrack_(track,
            Statics.TextTrackType.SIDE_LOADED_TTML,
            Statics.CaptionsMimeType.TTML);
    }

    isKnownTextTrack_(track, textTrackType, mimeType) {
        if (!track) {
            return false;
        }
        // The quarkCCPlayer.TextTrackType values match the
        // file extensions required
        const fileExtension = textTrackType;
        const trackContentId = track.trackContentId;
        const trackContentType = track.trackContentType;
        if ((trackContentId &&
            Statics.getExtension_(trackContentId) === fileExtension) ||
            (trackContentType && trackContentType.indexOf(mimeType) === 0)) {
            return true;
        }
        return false;
    }

    maybeLoadEmbeddedTracksMetadata_(info) {
        if (!info.message || !info.message.media) {
            return;
        }
        let tracksInfo = this.readInBandTracksInfo_();

        if(!info.message.media.textTrackStyle){
            info.message.media.textTrackStyle = {
                backgroundColor:'#FFFFFF00'
            }
        }
        else info.message.media.textTrackStyle.backgroundColor = '#FFFFFF00';

        if (tracksInfo) {
            this.textTrackType_ = Statics.TextTrackType.EMBEDDED;
            tracksInfo.textTrackStyle = info.message.media.textTrackStyle;
            this.mediaManager_.loadTracksInfo(tracksInfo);
        }
    }

    readInBandTracksInfo_() {
        const protocol = this.player_ ? this.player_.getStreamingProtocol() : null;
        if (!protocol) {
            return null;
        }
        const streamCount = protocol.getStreamCount();
        let activeTrackIds = [];
        let tracks = [];
        for (let i = 0; i < streamCount; i++) {
            let trackId = i + 1;
            if (protocol.isStreamEnabled(i)) {
                activeTrackIds.push(trackId);
            }
            const streamInfo = protocol.getStreamInfo(i);
            const mimeType = streamInfo.mimeType;
            let track;
            if (mimeType.indexOf(Statics.TrackType.TEXT) === 0 ||
                mimeType === Statics.CaptionsMimeType.TTML) {
                track = new cast.receiver.media.Track(
                    trackId, cast.receiver.media.TrackType.TEXT);
            } else if (mimeType.indexOf(Statics.TrackType.VIDEO) === 0) {
                track = new cast.receiver.media.Track(
                    trackId, cast.receiver.media.TrackType.VIDEO);
            } else if (mimeType.indexOf(Statics.TrackType.AUDIO) === 0) {
                track = new cast.receiver.media.Track(
                    trackId, cast.receiver.media.TrackType.AUDIO);
            }
            if (track) {
                track.name = streamInfo.name;
                track.language = streamInfo.language;
                track.trackContentType = streamInfo.mimeType;
                tracks.push(track);
            }
        }
        if (tracks.length === 0) {
            return null;
        }
        const tracksInfo = /** @type {cast.receiver.media.TracksInfo} **/ ({
            tracks: tracks,
            activeTrackIds: activeTrackIds
        });
        return tracksInfo;
    }

    onEditTracksInfo_(event) {
        Logger.addLog('onEditTracksInfo');
        this.onEditTracksInfoOrig_(event);

        // If the captions are embedded or ttml we need to enable/disable tracks
        // as needed (vtt is processed by the media manager)
        if (!event.data || !event.data.activeTrackIds || !this.textTrackType_) {
            return;
        }
        const mediaInformation = this.mediaManager_.getMediaInformation() || {};
        const type = this.textTrackType_;
        const mTracks = this.allTracks;
        const activeTracks = event.data.activeTrackIds;

        this.changeLanguage(this.allTracks, activeTracks);

        if (type == Statics.TextTrackType.SIDE_LOADED_TTML) {
            // The player_ may not have been created yet if the type of media did
            // not require MPL. It will be lazily created in processTtmlCues_
            if (this.player_) {
                this.player_.enableCaptions(false, cast.player.api.CaptionsType.TTML);
            }
            this.processTtmlCues_(event.data.activeTrackIds,
                mediaInformation.tracks || []);
        } else if (type == Statics.TextTrackType.EMBEDDED) {
            this.player_.enableCaptions(false);
            this.processInBandTracks_(event.data.activeTrackIds);
            this.player_.enableCaptions(true);
        }
    }

    changeLanguage(allTracks, activeTracks) {
        const streams = [];
        const audioStreams = [];
        const textTracks = [];

        const protocol = this.player_.getStreamingProtocol();
        const streamCount = protocol.getStreamCount();
        let currentLanguageIndex = -1;
        let streamInfo;

        for (let i = 0; i < allTracks.length; i++) {
            let track = allTracks[i];
            if (track.type == "TEXT") {
                textTracks.push(track);
            }
        }

        for (let i = 0; i < streamCount; i++) {
            streamInfo = protocol.getStreamInfo(i);
            streams.push(streamInfo);
            if (streamInfo.mimeType.indexOf('audio') === 0) {
                audioStreams.push(streamInfo);
                if (protocol.isStreamEnabled(i)) {
                    currentLanguageIndex = i;
                }
            }
        }

        var activeTrack = 0;
        if (activeTracks.length > 1) {
            activeTrack = activeTracks[1] - textTracks.length - 1;
        } else {
            activeTrack = activeTracks[0] - textTracks.length - 1;
        }


        if (activeTrack != currentLanguageIndex && activeTrack >= 0) {
            protocol.enableStream(currentLanguageIndex, false);
            protocol.enableStream(activeTrack, true);

            this.player_.reload();
        }
    }

    processInBandTracks_(activeTrackIds) {
        const protocol = this.player_.getStreamingProtocol();
        const streamCount = protocol.getStreamCount();
        let streamInfo;

        for (let i = 0; i < streamCount; i++) {
            let trackId = i + 1;
            let isActive = false;
            for (let j = 0; j < activeTrackIds.length; j++) {
                if (activeTrackIds[j] == trackId) {
                    isActive = true;
                    break;
                }
            }
            let wasActive = protocol.isStreamEnabled(i);
            if (isActive && !wasActive) {
                protocol.enableStream(i, true);
            } else if (!isActive && wasActive) {
                protocol.enableStream(i, false);
            }
        }
    }

    onStop_(event) {
        Logger.addLog('onStop');
        this.cancelDeferredPlay_('media is stopped');
        let self = this;
        Statics.transition_(self.element_, Statics.TRANSITION_DURATION_,
            function() {
                self.setState_(Statics.State.IDLE, false);
                self.onStopOrig_(event);
            });
    }

    getMediaElement() {
        return this.mediaElement_;
    }

    getMediaManager() {
        return this.mediaManager_;
    }

    getPlayer() {
        return this.player_;
    }

    start() {
        this.receiverManager_.start();
    }

    changeCaptions(activeTrackIds) {
        let current, next;
        const protocol = this.player_.getStreamingProtocol();
        const streamCount = protocol.getStreamCount();
        let streamInfo;
        for (current = 0; current < streamCount; current++) {
            if (this.protocol_.isStreamEnabled(current)) {
                streamInfo = this.protocol_.getStreamInfo(current);
                if (streamInfo.mimeType.indexOf('text') === 0) {
                    break;
                }
            }
        }

        if (current === streamCount) {
            next = 0;
        } else {
            next = current + 1;
        }

        while (next !== current) {
            if (next === streamCount) {
                next = 0;
            }

            streamInfo = this.protocol_.getStreamInfo(next);
            if (streamInfo.mimeType.indexOf('text') === 0) {
                break;
            }

            next++;
        }

        if (next !== current) {
            if (current !== streamCount) {
                this.protocol_.enableStream(current, false);
                this.player_.enableCaptions(false);
            }

            if (next !== streamCount) {
                this.protocol_.enableStream(next, true);
                this.player_.enableCaptions(true);
            }
        }
    }

    setIdleTimeout_(t) {
        Logger.addLog('setIdleTimeout_: ' + t);
        let self = this;
        clearTimeout(this.idleTimerId_);
        if (t) {
            this.idleTimerId_ = setTimeout(function() {
                self.receiverManager_.stop();
            }, t);
        }
    }

}
window.Receiver = Receiver;
export default Receiver;

