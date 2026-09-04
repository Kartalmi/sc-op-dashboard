/*
 * GOFO SC Ops Console — shared data loader.
 *
 * Single source of truth for the whole site:
 *   data/stations.csv     station, head, address, address_zip, lat, lon, color, coord_source
 *   data/assignments.csv  station, zip, route, dsp, volume, price   (one row per station+zip+route)
 *
 * Everything else — station totals, average prices, the route table, the DSP
 * summary — is derived here at load time. Nothing operational is baked into the
 * pages, so editing the CSVs is the only way to change the numbers.
 *
 * GofoData.load(base, geo) -> Promise<{stations, dsp_summary, meta}>
 *   base : path prefix to the site root ('' from index.html, '../' from analytics/)
 *   geo  : optional zipgeo FeatureCollection; supplies has_geom + ZIP centroids
 */
(function (global) {
  "use strict";

  var FALLBACK_PALETTE = [
    '#2DD9C6', '#F2A93B', '#FF6B6B', '#8B7FF0', '#4FB6FF', '#A3D65C', '#FF8FC7',
    '#6E7FDB', '#E0C341', '#46C99A', '#E8734A', '#7FA5C9', '#C87FEA', '#5FD1F0'
  ];

  function round3(n) { return Math.round(n * 1000) / 1000; }

  // RFC-4180-ish: handles quoted fields (station addresses contain commas) and
  // doubled quotes inside them. Returns array of arrays.
  function parseCsv(text) {
    var rows = [], row = [], field = '', inQuotes = false, i;
    text = text.replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows;
  }

  // Turn a parsed CSV into objects keyed by its header row, lowercased.
  function toRecords(text) {
    var rows = parseCsv(text);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = (r[i] === undefined ? '' : r[i]).trim(); });
      return o;
    });
  }

  function fetchText(url) {
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.text();
    });
  }

  // Area-weighted centroid of the largest ring — only a fallback for ZIPs added to
  // the CSV whose geometry carries no precomputed lat/lon.
  function ringCentroid(geom) {
    var rings = geom.type === 'Polygon'
      ? geom.coordinates
      : geom.coordinates.reduce(function (a, p) { return a.concat(p); }, []);
    var best = null, bestArea = -1;
    rings.forEach(function (r) {
      var a = 0;
      for (var i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = r; }
    });
    if (!best) return null;
    var a2 = 0, cx = 0, cy = 0;
    for (var i = 0; i < best.length - 1; i++) {
      var cross = best[i][0] * best[i + 1][1] - best[i + 1][0] * best[i][1];
      a2 += cross;
      cx += (best[i][0] + best[i + 1][0]) * cross;
      cy += (best[i][1] + best[i + 1][1]) * cross;
    }
    a2 *= 0.5;
    if (Math.abs(a2) < 1e-12) return null;
    return { lat: cy / (6 * a2), lon: cx / (6 * a2) };
  }

  function geoIndex(geo) {
    var idx = {};
    if (!geo || !geo.features) return idx;
    geo.features.forEach(function (f) {
      var p = f.properties || {};
      if (!p.zip) return;
      var lat = p.lat, lon = p.lon;
      if (lat === undefined || lon === undefined || lat === null || lon === null) {
        var c = f.geometry ? ringCentroid(f.geometry) : null;
        if (c) { lat = c.lat; lon = c.lon; }
      }
      idx[p.zip] = { lat: lat === undefined ? null : lat, lon: lon === undefined ? null : lon };
    });
    return idx;
  }

  function build(stationRows, assignRows, geo) {
    var warnings = [];
    var gidx = geoIndex(geo);
    var haveGeo = Object.keys(gidx).length > 0;

    // ---- station metadata ----
    var meta = {}, order = [];
    stationRows.forEach(function (r, i) {
      var key = (r.station || '').toUpperCase();
      if (!key) { warnings.push('stations.csv line ' + (i + 2) + ': blank station, skipped'); return; }
      if (meta[key]) { warnings.push('stations.csv: duplicate station ' + key + ', later row wins'); }
      else order.push(key);
      var lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      meta[key] = {
        name: key,
        head: r.head || '',
        address: r.address || '',
        address_zip: r.address_zip || '',
        lat: isFinite(lat) ? lat : null,
        lon: isFinite(lon) ? lon : null,
        color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : null,
        coord_source: r.coord_source || 'address_zip'
      };
    });

    // ---- assignment rows -> station -> zip ----
    var stations = {};
    function station(key) {
      if (!stations[key]) {
        if (!meta[key]) {
          warnings.push('assignments.csv: station ' + key + ' is missing from stations.csv (no pin, no address)');
          meta[key] = { name: key, head: '', address: '', address_zip: '', lat: null, lon: null, color: null, coord_source: 'address_zip' };
          order.push(key);
        }
        var m = meta[key];
        stations[key] = {
          name: key, head: m.head, address: m.address, address_zip: m.address_zip,
          lat: m.lat, lon: m.lon, color: m.color, coord_source: m.coord_source,
          zips: [], _byZip: {}
        };
      }
      return stations[key];
    }

    assignRows.forEach(function (r, i) {
      var ln = i + 2;
      var sKey = (r.station || '').toUpperCase();
      var zip = (r.zip || '').trim();
      var route = (r.route || '').trim();
      var dsp = (r.dsp || '').trim();
      var vol = parseFloat(r.volume);
      var price = parseFloat(r.price);
      if (!sKey && !zip && !route) return;
      if (!/^\d{5}$/.test(zip)) { warnings.push('assignments.csv line ' + ln + ': bad ZIP "' + zip + '", row skipped'); return; }
      if (!sKey) { warnings.push('assignments.csv line ' + ln + ': missing station, row skipped'); return; }
      if (!route) { warnings.push('assignments.csv line ' + ln + ': missing route, row skipped'); return; }
      if (!dsp) { warnings.push('assignments.csv line ' + ln + ': missing DSP, row skipped'); return; }
      if (!isFinite(vol) || vol < 0) { warnings.push('assignments.csv line ' + ln + ': bad volume "' + r.volume + '", treated as 0'); vol = 0; }
      if (!isFinite(price) || price < 0) { warnings.push('assignments.csv line ' + ln + ': bad price "' + r.price + '", treated as 0'); price = 0; }

      var st = station(sKey);
      var z = st._byZip[zip];
      if (!z) {
        var g = gidx[zip];
        z = st._byZip[zip] = {
          zip: zip, volume: 0, price: 0, dsps: {}, routes: {},
          has_geom: haveGeo ? !!g : false,
          lat: g ? g.lat : null, lon: g ? g.lon : null,
          _pNum: 0, _pDen: 0, _pList: []
        };
        st.zips.push(z);
      }
      if (z.routes[route] !== undefined) {
        warnings.push('assignments.csv line ' + ln + ': duplicate row for ' + sKey + '/' + zip + '/' + route + ', volumes added');
      }
      z.volume += vol;
      z.routes[route] = (z.routes[route] || 0) + vol;
      z.dsps[dsp] = (z.dsps[dsp] || 0) + vol;
      // a ZIP's price is the volume-weighted mean of its rows, so splitting one ZIP
      // across routes at different rates works without touching this code
      z._pNum += price * vol; z._pDen += vol; z._pList.push(price);
    });

    // ---- derive per-ZIP price, then every aggregate ----
    var dsp_summary = {};
    Object.keys(stations).forEach(function (sKey) {
      var st = stations[sKey];
      st.zips.forEach(function (z) {
        z.price = round3(z._pDen > 0
          ? z._pNum / z._pDen
          : z._pList.reduce(function (a, b) { return a + b; }, 0) / z._pList.length);
        delete z._pNum; delete z._pDen; delete z._pList;
      });
      st.zips.sort(function (a, b) { return b.volume - a.volume || a.zip.localeCompare(b.zip); });
      delete st._byZip;

      st.total_volume = st.zips.reduce(function (a, z) { return a + z.volume; }, 0);
      st.zip_count = st.zips.length;

      var priced = st.zips.filter(function (z) { return z.price > 0; });
      var pv = priced.reduce(function (a, z) { return a + z.volume; }, 0);
      st.avg_price = priced.length
        ? round3(pv > 0
          ? priced.reduce(function (a, z) { return a + z.price * z.volume; }, 0) / pv
          : priced.reduce(function (a, z) { return a + z.price; }, 0) / priced.length)
        : 0;

      var dspSet = {};
      st.zips.forEach(function (z) { Object.keys(z.dsps).forEach(function (d) { dspSet[d] = 1; }); });
      st.dsps = Object.keys(dspSet).sort();

      // route table
      var acc = {};
      st.zips.forEach(function (z) {
        Object.keys(z.routes).forEach(function (rt) {
          var v = z.routes[rt];
          var a = acc[rt] || (acc[rt] = { volume: 0, zip_count: 0, num: 0, den: 0, list: [], dsps: {} });
          a.volume += v; a.zip_count++; a.num += z.price * v; a.den += v; a.list.push(z.price);
          Object.keys(z.dsps).forEach(function (d) { a.dsps[d] = (a.dsps[d] || 0) + z.dsps[d]; });
        });
      });
      st.routes = Object.keys(acc).map(function (rt) {
        var a = acc[rt];
        var dom = null, dv = -1;
        Object.keys(a.dsps).forEach(function (d) { if (a.dsps[d] > dv) { dv = a.dsps[d]; dom = d; } });
        return {
          route: rt, volume: a.volume, zip_count: a.zip_count,
          price: round3(a.den > 0 ? a.num / a.den : a.list.reduce(function (x, y) { return x + y; }, 0) / a.list.length),
          dominant_dsp: dom
        };
      }).sort(function (a, b) { return b.volume - a.volume || a.route.localeCompare(b.route); });

      // DSP rollup — avg price weights by the ZIP's total volume, matching the
      // station and route averages above
      st.zips.forEach(function (z) {
        Object.keys(z.dsps).forEach(function (d) {
          var e = dsp_summary[d] || (dsp_summary[d] = { volume: 0, zip_count: 0, stations: [], _st: {}, _num: 0, _den: 0, _list: [] });
          e.volume += z.dsps[d];
          e.zip_count++;
          e._st[sKey] = 1;
          if (z.price > 0) { e._num += z.price * z.volume; e._den += z.volume; e._list.push(z.price); }
        });
      });
    });

    Object.keys(dsp_summary).forEach(function (d) {
      var e = dsp_summary[d];
      e.stations = Object.keys(e._st).sort();
      e.avg_price = e._list.length
        ? round3(e._den > 0 ? e._num / e._den : e._list.reduce(function (a, b) { return a + b; }, 0) / e._list.length)
        : 0;
      delete e._st; delete e._num; delete e._den; delete e._list;
    });

    // stable station order + colour fallback for stations added without one
    var sortedKeys = Object.keys(stations).sort();
    var out = {};
    sortedKeys.forEach(function (k, i) {
      if (!stations[k].color) {
        stations[k].color = FALLBACK_PALETTE[i % FALLBACK_PALETTE.length];
        warnings.push('stations.csv: ' + k + ' has no colour, using ' + stations[k].color);
      }
      out[k] = stations[k];
    });

    return {
      stations: out,
      dsp_summary: dsp_summary,
      meta: {
        station_count: sortedKeys.length,
        zip_rows: Object.keys(out).reduce(function (a, k) { return a + out[k].zips.length; }, 0),
        assignment_rows: assignRows.length,
        route_count: Object.keys(out).reduce(function (a, k) { return a + out[k].routes.length; }, 0),
        dsp_count: Object.keys(dsp_summary).length,
        total_volume: Object.keys(out).reduce(function (a, k) { return a + out[k].total_volume; }, 0),
        warnings: warnings
      }
    };
  }

  global.GofoData = {
    load: function (base, geo) {
      base = base || '';
      return Promise.all([
        fetchText(base + 'data/stations.csv'),
        fetchText(base + 'data/assignments.csv')
      ]).then(function (texts) {
        return build(toRecords(texts[0]), toRecords(texts[1]), geo);
      });
    }
  };
})(window);
