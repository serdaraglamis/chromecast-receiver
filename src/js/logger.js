/**
 * Created by serdar.aglamis on 03/08/2017.
 */

export default class Logger {
    static loggerEnabled = true;

    static addLog(message) {
        if(Logger.loggerEnabled && message) {
            console.log('%c QCC ', 'background: #a50000; color: #bbbbbb', message);
        }
    }
}

