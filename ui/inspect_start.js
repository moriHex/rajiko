const needChangeTZ = Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase() != 'asia/tokyo';
if (needChangeTZ) {
    //for those who are from different timezones.
    //TODO: better solution? such as changing Date prototype? 

    //! moment-timezone.js
    //! version : 0.5.14
    //! Copyright (c) JS Foundation and other contributors
    //! license : MIT
    //! github.com/moment/moment-timezone
    (function (root, factory) {
        "use strict";

        /*global define*/
        if (typeof define === 'function' && define.amd) {
            define(['moment'], factory);                 // AMD
        } else if (typeof module === 'object' && module.exports) {
            module.exports = factory(require('moment')); // Node
        } else {
            factory(root.moment);                        // Browser
        }

    }(this, function (moment) {
        "use strict";

        // Do not load moment-timezone a second time.
        // if (moment.tz !== undefined) {
        //  logError('Moment Timezone ' + moment.tz.version + ' was already loaded ' + (moment.tz.dataVersion ? 'with data from ' : 'without any data') + moment.tz.dataVersion);
        //  return moment;
        // }

        var VERSION = "0.5.14",
            zones = {},
            links = {},
            names = {},
            guesses = {},
            cachedGuess,

            momentVersion = moment.version.split('.'),
            major = +momentVersion[0],
            minor = +momentVersion[1];

        // Moment.js version check
        if (major < 2 || (major === 2 && minor < 6)) {
            logError('Moment Timezone requires Moment.js >= 2.6.0. You are using Moment.js ' + moment.version + '. See momentjs.com');
        }

        /************************************
            Unpacking
        ************************************/

        function charCodeToInt(charCode) {
            if (charCode > 96) {
                return charCode - 87;
            } else if (charCode > 64) {
                return charCode - 29;
            }
            return charCode - 48;
        }

        function unpackBase60(string) {
            var i = 0,
                parts = string.split('.'),
                whole = parts[0],
                fractional = parts[1] || '',
                multiplier = 1,
                num,
                out = 0,
                sign = 1;

            // handle negative numbers
            if (string.charCodeAt(0) === 45) {
                i = 1;
                sign = -1;
            }

            // handle digits before the decimal
            for (i; i < whole.length; i++) {
                num = charCodeToInt(whole.charCodeAt(i));
                out = 60 * out + num;
            }

            // handle digits after the decimal
            for (i = 0; i < fractional.length; i++) {
                multiplier = multiplier / 60;
                num = charCodeToInt(fractional.charCodeAt(i));
                out += num * multiplier;
            }

            return out * sign;
        }

        function arrayToInt(array) {
            for (var i = 0; i < array.length; i++) {
                array[i] = unpackBase60(array[i]);
            }
        }

        function intToUntil(array, length) {
            for (var i = 0; i < length; i++) {
                array[i] = Math.round((array[i - 1] || 0) + (array[i] * 60000)); // minutes to milliseconds
            }

            array[length - 1] = Infinity;
        }

        function mapIndices(source, indices) {
            var out = [], i;

            for (i = 0; i < indices.length; i++) {
                out[i] = source[indices[i]];
            }

            return out;
        }

        function unpack(string) {
            var data = string.split('|'),
                offsets = data[2].split(' '),
                indices = data[3].split(''),
                untils = data[4].split(' ');

            arrayToInt(offsets);
            arrayToInt(indices);
            arrayToInt(untils);

            intToUntil(untils, indices.length);

            return {
                name: data[0],
                abbrs: mapIndices(data[1].split(' '), indices),
                offsets: mapIndices(offsets, indices),
                untils: untils,
                population: data[5] | 0
            };
        }

        /************************************
            Zone object
        ************************************/

        function Zone(packedString) {
            if (packedString) {
                this._set(unpack(packedString));
            }
        }

        Zone.prototype = {
            _set: function (unpacked) {
                this.name = unpacked.name;
                this.abbrs = unpacked.abbrs;
                this.untils = unpacked.untils;
                this.offsets = unpacked.offsets;
                this.population = unpacked.population;
            },

            _index: function (timestamp) {
                var target = +timestamp,
                    untils = this.untils,
                    i;

                for (i = 0; i < untils.length; i++) {
                    if (target < untils[i]) {
                        return i;
                    }
                }
            },

            parse: function (timestamp) {
                var target = +timestamp,
                    offsets = this.offsets,
                    untils = this.untils,
                    max = untils.length - 1,
                    offset, offsetNext, offsetPrev, i;

                for (i = 0; i < max; i++) {
                    offset = offsets[i];
                    offsetNext = offsets[i + 1];
                    offsetPrev = offsets[i ? i - 1 : i];

                    if (offset < offsetNext && tz.moveAmbiguousForward) {
                        offset = offsetNext;
                    } else if (offset > offsetPrev && tz.moveInvalidForward) {
                        offset = offsetPrev;
                    }

                    if (target < untils[i] - (offset * 60000)) {
                        return offsets[i];
                    }
                }

                return offsets[max];
            },

            abbr: function (mom) {
                return this.abbrs[this._index(mom)];
            },

            offset: function (mom) {
                logError("zone.offset has been deprecated in favor of zone.utcOffset");
                return this.offsets[this._index(mom)];
            },

            utcOffset: function (mom) {
                return this.offsets[this._index(mom)];
            }
        };

        /************************************
            Current Timezone
        ************************************/

        function OffsetAt(at) {
            var timeString = at.toTimeString();
            var abbr = timeString.match(/\([a-z ]+\)/i);
            if (abbr && abbr[0]) {
                // 17:56:31 GMT-0600 (CST)
                // 17:56:31 GMT-0600 (Central Standard Time)
                abbr = abbr[0].match(/[A-Z]/g);
                abbr = abbr ? abbr.join('') : undefined;
            } else {
                // 17:56:31 CST
                // 17:56:31 GMT+0800 (台北標準時間)
                abbr = timeString.match(/[A-Z]{3,5}/g);
                abbr = abbr ? abbr[0] : undefined;
            }

            if (abbr === 'GMT') {
                abbr = undefined;
            }

            this.at = +at;
            this.abbr = abbr;
            this.offset = at.getTimezoneOffset();
        }

        function ZoneScore(zone) {
            this.zone = zone;
            this.offsetScore = 0;
            this.abbrScore = 0;
        }

        ZoneScore.prototype.scoreOffsetAt = function (offsetAt) {
            this.offsetScore += Math.abs(this.zone.utcOffset(offsetAt.at) - offsetAt.offset);
            if (this.zone.abbr(offsetAt.at).replace(/[^A-Z]/g, '') !== offsetAt.abbr) {
                this.abbrScore++;
            }
        };

        function findChange(low, high) {
            var mid, diff;

            while ((diff = ((high.at - low.at) / 12e4 | 0) * 6e4)) {
                mid = new OffsetAt(new Date(low.at + diff));
                if (mid.offset === low.offset) {
                    low = mid;
                } else {
                    high = mid;
                }
            }

            return low;
        }

        function userOffsets() {
            var startYear = new Date().getFullYear() - 2,
                last = new OffsetAt(new Date(startYear, 0, 1)),
                offsets = [last],
                change, next, i;

            for (i = 1; i < 48; i++) {
                next = new OffsetAt(new Date(startYear, i, 1));
                if (next.offset !== last.offset) {
                    change = findChange(last, next);
                    offsets.push(change);
                    offsets.push(new OffsetAt(new Date(change.at + 6e4)));
                }
                last = next;
            }

            for (i = 0; i < 4; i++) {
                offsets.push(new OffsetAt(new Date(startYear + i, 0, 1)));
                offsets.push(new OffsetAt(new Date(startYear + i, 6, 1)));
            }

            return offsets;
        }

        function sortZoneScores(a, b) {
            if (a.offsetScore !== b.offsetScore) {
                return a.offsetScore - b.offsetScore;
            }
            if (a.abbrScore !== b.abbrScore) {
                return a.abbrScore - b.abbrScore;
            }
            return b.zone.population - a.zone.population;
        }

        function addToGuesses(name, offsets) {
            var i, offset;
            arrayToInt(offsets);
            for (i = 0; i < offsets.length; i++) {
                offset = offsets[i];
                guesses[offset] = guesses[offset] || {};
                guesses[offset][name] = true;
            }
        }

        function guessesForUserOffsets(offsets) {
            var offsetsLength = offsets.length,
                filteredGuesses = {},
                out = [],
                i, j, guessesOffset;

            for (i = 0; i < offsetsLength; i++) {
                guessesOffset = guesses[offsets[i].offset] || {};
                for (j in guessesOffset) {
                    if (guessesOffset.hasOwnProperty(j)) {
                        filteredGuesses[j] = true;
                    }
                }
            }

            for (i in filteredGuesses) {
                if (filteredGuesses.hasOwnProperty(i)) {
                    out.push(names[i]);
                }
            }

            return out;
        }

        function rebuildGuess() {

            // use Intl API when available and returning valid time zone
            try {
                var intlName = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (intlName && intlName.length > 3) {
                    var name = names[normalizeName(intlName)];
                    if (name) {
                        return name;
                    }
                    logError("Moment Timezone found " + intlName + " from the Intl api, but did not have that data loaded.");
                }
            } catch (e) {
                // Intl unavailable, fall back to manual guessing.
            }

            var offsets = userOffsets(),
                offsetsLength = offsets.length,
                guesses = guessesForUserOffsets(offsets),
                zoneScores = [],
                zoneScore, i, j;

            for (i = 0; i < guesses.length; i++) {
                zoneScore = new ZoneScore(getZone(guesses[i]), offsetsLength);
                for (j = 0; j < offsetsLength; j++) {
                    zoneScore.scoreOffsetAt(offsets[j]);
                }
                zoneScores.push(zoneScore);
            }

            zoneScores.sort(sortZoneScores);

            return zoneScores.length > 0 ? zoneScores[0].zone.name : undefined;
        }

        function guess(ignoreCache) {
            if (!cachedGuess || ignoreCache) {
                cachedGuess = rebuildGuess();
            }
            return cachedGuess;
        }

        /************************************
            Global Methods
        ************************************/

        function normalizeName(name) {
            return (name || '').toLowerCase().replace(/\//g, '_');
        }

        function addZone(packed) {
            var i, name, split, normalized;

            if (typeof packed === "string") {
                packed = [packed];
            }

            for (i = 0; i < packed.length; i++) {
                split = packed[i].split('|');
                name = split[0];
                normalized = normalizeName(name);
                zones[normalized] = packed[i];
                names[normalized] = name;
                addToGuesses(normalized, split[2].split(' '));
            }
        }

        function getZone(name, caller) {
            name = normalizeName(name);

            var zone = zones[name];
            var link;

            if (zone instanceof Zone) {
                return zone;
            }

            if (typeof zone === 'string') {
                zone = new Zone(zone);
                zones[name] = zone;
                return zone;
            }

            // Pass getZone to prevent recursion more than 1 level deep
            if (links[name] && caller !== getZone && (link = getZone(links[name], getZone))) {
                zone = zones[name] = new Zone();
                zone._set(link);
                zone.name = names[name];
                return zone;
            }

            return null;
        }

        function getNames() {
            var i, out = [];

            for (i in names) {
                if (names.hasOwnProperty(i) && (zones[i] || zones[links[i]]) && names[i]) {
                    out.push(names[i]);
                }
            }

            return out.sort();
        }

        function addLink(aliases) {
            var i, alias, normal0, normal1;

            if (typeof aliases === "string") {
                aliases = [aliases];
            }

            for (i = 0; i < aliases.length; i++) {
                alias = aliases[i].split('|');

                normal0 = normalizeName(alias[0]);
                normal1 = normalizeName(alias[1]);

                links[normal0] = normal1;
                names[normal0] = alias[0];

                links[normal1] = normal0;
                names[normal1] = alias[1];
            }
        }

        function loadData(data) {
            addZone(data.zones);
            addLink(data.links);
            tz.dataVersion = data.version;
        }

        function zoneExists(name) {
            if (!zoneExists.didShowError) {
                zoneExists.didShowError = true;
                logError("moment.tz.zoneExists('" + name + "') has been deprecated in favor of !moment.tz.zone('" + name + "')");
            }
            return !!getZone(name);
        }

        function needsOffset(m) {
            var isUnixTimestamp = (m._f === 'X' || m._f === 'x');
            return !!(m._a && (m._tzm === undefined) && !isUnixTimestamp);
        }

        function logError(message) {
            if (typeof console !== 'undefined' && typeof console.error === 'function') {
                console.error(message);
            }
        }

        /************************************
            moment.tz namespace
        ************************************/

        function tz(input) {
            var args = Array.prototype.slice.call(arguments, 0, -1),
                name = arguments[arguments.length - 1],
                zone = getZone(name),
                out = moment.utc.apply(null, args);

            if (zone && !moment.isMoment(input) && needsOffset(out)) {
                out.add(zone.parse(out), 'minutes');
            }

            out.tz(name);

            return out;
        }

        tz.version = VERSION;
        tz.dataVersion = '';
        tz._zones = zones;
        tz._links = links;
        tz._names = names;
        tz.add = addZone;
        tz.link = addLink;
        tz.load = loadData;
        tz.zone = getZone;
        tz.zoneExists = zoneExists; // deprecated in 0.1.0
        tz.guess = guess;
        tz.names = getNames;
        tz.Zone = Zone;
        tz.unpack = unpack;
        tz.unpackBase60 = unpackBase60;
        tz.needsOffset = needsOffset;
        tz.moveInvalidForward = true;
        tz.moveAmbiguousForward = false;

        /************************************
            Interface with Moment.js
        ************************************/

        var fn = moment.fn;

        moment.tz = tz;

        moment.defaultZone = null;

        moment.updateOffset = function (mom, keepTime) {
            var zone = moment.defaultZone,
                offset;

            if (mom._z === undefined) {
                if (zone && needsOffset(mom) && !mom._isUTC) {
                    mom._d = moment.utc(mom._a)._d;
                    mom.utc().add(zone.parse(mom), 'minutes');
                }
                mom._z = zone;
            }
            if (mom._z) {
                offset = mom._z.utcOffset(mom);
                if (Math.abs(offset) < 16) {
                    offset = offset / 60;
                }
                if (mom.utcOffset !== undefined) {
                    mom.utcOffset(-offset, keepTime);
                } else {
                    mom.zone(offset, keepTime);
                }
            }
        };

        fn.tz = function (name, keepTime) {
            if (name) {
                this._z = getZone(name);
                if (this._z) {
                    moment.updateOffset(this, keepTime);
                } else {
                    logError("Moment Timezone has no data for " + name + ". See http://momentjs.com/timezone/docs/#/data-loading/.");
                }
                return this;
            }
            if (this._z) { return this._z.name; }
        };

        function abbrWrap(old) {
            return function () {
                if (this._z) { return this._z.abbr(this); }
                return old.call(this);
            };
        }

        function resetZoneWrap(old) {
            return function () {
                this._z = null;
                return old.apply(this, arguments);
            };
        }

        fn.zoneName = abbrWrap(fn.zoneName);
        fn.zoneAbbr = abbrWrap(fn.zoneAbbr);
        fn.utc = resetZoneWrap(fn.utc);

        moment.tz.setDefault = function (name) {
            if (major < 2 || (major === 2 && minor < 9)) {
                logError('Moment Timezone setDefault() requires Moment.js >= 2.9.0. You are using Moment.js ' + moment.version + '.');
            }
            moment.defaultZone = name ? getZone(name) : null;
            return moment;
        };

        // Cloning a moment should include the _z property.
        var momentProperties = moment.momentProperties;
        if (Object.prototype.toString.call(momentProperties) === '[object Array]') {
            // moment 2.8.1+
            momentProperties.push('_z');
            momentProperties.push('_a');
        } else if (momentProperties) {
            // moment 2.7.0
            momentProperties._z = null;
        }

        // INJECT DATA

        return moment;
    }));
    //! moment-timezone.js end

    moment.tz.add("Asia/Tokyo|JST JDT|-90 -a0|010101010|-QJH0 QL0 1lB0 13X0 1zB0 NX0 1zB0 NX0|38e6");
    moment.tz.link("Asia/Tokyo|Japan");
    const tokyozone = moment.tz.zone("Asia/Tokyo");
    moment.defaultZone = tokyozone;

    // moment.tz.zone('Asia/Tokyo').utcOffset(0)) -> -540
    const diffMin = (new Date()).getTimezoneOffset() - moment.tz.zone('Asia/Tokyo').utcOffset(0);
    const diffTimestamp = -1 * 60 * 1000 * diffMin; //different direction
    const diffSec = diffMin * 60;
    const diffHour = diffMin / 60;

    // for timeshift's timetable
    let oldsetScrollInit = setScrollInit;
    setScrollInit = function () {
        let oldGetHours = Date.prototype.getHours;
        Date.prototype.getHours = function () { return (24 + oldGetHours.bind(this)() + Math.floor(diffHour)) % 24; };
        oldsetScrollInit();
        Date.prototype.getHours = oldGetHours;
    }

    //    var oldSetSeekPlayTime = $.Radiko.Player.setSeekPlayTime
    //    $.Radiko.Player.setSeekPlayTime = function(startSec,endSec) {
    //        return oldSetSeekPlayTime(startSec+diffSec,endSec-diffSec)}

    // note: this conflicts with setSeekPlayTime's modification
    let oldonChangeCurrentTime = $.Radiko.Player.View.seekBarView.__proto__.onChangeCurrentTime;
    $.Radiko.Player.View.seekBarView.stopListening($.Radiko.Player.Model, 'change:currentTime');
    $.Radiko.Player.View.seekBarView.listenTo($.Radiko.Player.Model, 'change:currentTime', function (model, currentTime) {
        // for past timeshift on non-default region -> 0
        // other ( ongoing timeshift on default/non-default , past timeshift on default) -> diffSec
        return oldonChangeCurrentTime(model, currentTime + (player.chasing() ? diffSec : 0));
    })

    //because ftTime is JST time
    //apps/js/playerCommon.js?_=20180221

    // this conflicts with newonDragSeek
    //var oldupdateBalloon = $.Radiko.Player.View.seekBarView.__proto__.updateBalloon;
    //$.Radiko.Player.View.seekBarView.__proto__.updateBalloon = function (ftTime, addTime) {
    //    oldupdateBalloon(ftTime + diffTimestamp, addTime);
    //}

    let oldonDragSeek = $.Radiko.Player.View.seekBarView.__proto__.onDragSeek;
    let newonDragSeek = function () { moment.defaultZone = null; oldonDragSeek.call($.Radiko.Player.View.seekBarView); moment.defaultZone = tokyozone; }

    $("#seekbar").find(".knob").draggable("option", { drag: newonDragSeek });
}



//break timeshift 3hour limit
// from tsdetail -> scheduleId (for 1 day , check every 1s ) && storeWatchId (for 3 hours,check on update)
// this watcher is the first.
store.watch('update',
    function (key, val, oldVal) { // if oldVal == undefined -> a new created one
        if (/[0-9]{14}$/.test(key)) {
            val.listened_time = 0;
            val.limit = moment(val.to, 'YYYYMMDDHHmmss').unix() + 8 * 24 * 60 * 60; //same as tsdetail.js, but will be delete after 8*2 days
            //use raw store api
            store.storage.write(key, JSON.stringify(val));
        }
    }
);
// Bypass question dialog
if (!store.get('rdk_profile_data')) {
    store.set('rdk_profile_data', true);
}




//to bypass check at 
// to enfore select stream_smh_multi url areafree = 0 link (bypass containStation check)
// also bypass connectiontype check! see allocateConnection
// to pass our generated token 
// this may run after d2-app report premium?
$.Radiko.login_status.areafree = 1;
$.Radiko.login_status.premium = 1;

window.isStationInArea = function () { return true; }
// `Preroll` is CM/AD related
// See onChunkListLoaded case 'AD-TYPE':
// 0 is for premium, so i think it is no-ad
// 2 maybe has AD
window.getPrerollParam = () => { return '0'; }
