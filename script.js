(() => {
  "use strict";
  const airports = [
    {code:"JFK",name:"John F. Kennedy International",city:"Нью-Йорк",country:"США",lat:40.6413,lon:-73.7781},
    {code:"LHR",name:"Heathrow Airport",city:"Лондон",country:"Великобритания",lat:51.4700,lon:-0.4543},
    {code:"HND",name:"Tokyo Haneda Airport",city:"Токио",country:"Япония",lat:35.5494,lon:139.7798},
    {code:"DXB",name:"Dubai International",city:"Дубай",country:"ОАЭ",lat:25.2532,lon:55.3657},
    {code:"CDG",name:"Charles de Gaulle Airport",city:"Париж",country:"Франция",lat:49.0097,lon:2.5479},
    {code:"SIN",name:"Singapore Changi Airport",city:"Сингапур",country:"Сингапур",lat:1.3644,lon:103.9915},
    {code:"SYD",name:"Sydney Kingsford Smith",city:"Сидней",country:"Австралия",lat:-33.9399,lon:151.1753},
    {code:"GRU",name:"São Paulo/Guarulhos",city:"Сан-Паулу",country:"Бразилия",lat:-23.4356,lon:-46.4731},
    {code:"CPT",name:"Cape Town International",city:"Кейптаун",country:"ЮАР",lat:-33.9700,lon:18.5972},
    {code:"SFO",name:"San Francisco International",city:"Сан-Франциско",country:"США",lat:37.6213,lon:-122.3790},
    {code:"YYZ",name:"Toronto Pearson International",city:"Торонто",country:"Канада",lat:43.6777,lon:-79.6248},
    {code:"IST",name:"Istanbul Airport",city:"Стамбул",country:"Турция",lat:41.2753,lon:28.7519},
    {code:"DEL",name:"Indira Gandhi International",city:"Дели",country:"Индия",lat:28.5562,lon:77.1000},
    {code:"MEX",name:"Mexico City International",city:"Мехико",country:"Мексика",lat:19.4363,lon:-99.0721},
    {code:"KEF",name:"Keflavík International",city:"Рейкьявик",country:"Исландия",lat:63.9850,lon:-22.6056},
    {code:"FRA",name:"Frankfurt Airport",city:"Франкфурт",country:"Германия",lat:50.0379,lon:8.5622}
  ];
  const $ = (id) => document.getElementById(id);
  const originSelect = $("origin"), destSelect = $("destination");
  const speedInput = $("speed");
  let map, routeLine = null, routeGlow = null, planeMarker = null;
  let airportLayers = [], routePoints = [], frame = null, lastFrame = 0, elapsed = 0;
  let state = "standby", progress = 0, routeDistanceKm = 0, speed = Number(speedInput.value), showAirports = true;
  let origin = airports[2], destination = airports[1];

  function optionLabel(a) { return `${a.code} · ${a.city}, ${a.country}`; }
  function populateSelects() {
    airports.forEach((a) => {
      const o1 = new Option(optionLabel(a), a.code);
      const o2 = new Option(optionLabel(a), a.code);
      originSelect.add(o1); destSelect.add(o2);
    });
    originSelect.value = "HND"; destSelect.value = "LHR";
  }
  function getAirport(code) { return airports.find(a => a.code === code); }
  function distanceKm(a,b) {
    const rad = d => d * Math.PI / 180;
    const dLat = rad(b.lat-a.lat), dLon = rad(b.lon-a.lon);
    const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }
  function formatDuration(hours) {
    const total = Math.round(hours * 60), h = Math.floor(total/60), m = total%60;
    return h ? `${h} ч ${String(m).padStart(2,"0")} мин` : `${m} мин`;
  }
  function formatDistance(km) { return Math.round(km / 1.852).toLocaleString("ru-RU"); }
  function interpolateGreatCircle(a,b,t) {
    const toVec = p => { const lat=p.lat*Math.PI/180, lon=p.lon*Math.PI/180; return [Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)]; };
    const A=toVec(a), B=toVec(b), dot=Math.max(-1,Math.min(1,A[0]*B[0]+A[1]*B[1]+A[2]*B[2])), omega=Math.acos(dot);
    if (omega < 1e-6) return [a.lat,a.lon];
    const s=Math.sin(omega), u=Math.sin((1-t)*omega)/s, v=Math.sin(t*omega)/s;
    const x=u*A[0]+v*B[0], y=u*A[1]+v*B[1], z=u*A[2]+v*B[2];
    return [Math.atan2(z,Math.sqrt(x*x+y*y))*180/Math.PI, Math.atan2(y,x)*180/Math.PI];
  }
  function buildArc(a,b,steps=100) {
    const points=[];
    for(let i=0;i<=steps;i++) points.push(interpolateGreatCircle(a,b,i/steps));
    // Avoid world-spanning lines at the antimeridian by splitting into visible segments.
    const segments=[]; let segment=[points[0]];
    for(let i=1;i<points.length;i++){
      if(Math.abs(points[i][1]-points[i-1][1])>180){ if(segment.length>1) segments.push(segment); segment=[points[i]]; }
      else segment.push(points[i]);
    }
    if(segment.length>1) segments.push(segment);
    return {points,segments};
  }
  function createAirportIcon(isDest=false) {
    return L.divIcon({className:"",html:`<div class="airport-marker${isDest?" destination":""}"></div>`,iconSize:[11,11],iconAnchor:[5.5,5.5]});
  }
  function createPlaneIcon() {
    return L.divIcon({className:"",html:'<div class="plane-marker"><span>✈</span></div>',iconSize:[36,36],iconAnchor:[18,18]});
  }
  function initMap() {
    map=L.map("map",{worldCopyJump:true,zoomControl:true,preferCanvas:true}).setView([27,15],2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
    }).addTo(map);
    airports.forEach(a=>{
      const marker=L.marker([a.lat,a.lon],{icon:createAirportIcon(false),title:optionLabel(a)}).bindPopup(`<div class="airport-popup"><div class="popup-code">${a.code}</div><strong>${a.city}</strong><div class="popup-city">${a.name}</div></div>`);
      marker.on("click",()=>{$("coords").textContent=`${a.code} · ${a.lat.toFixed(3)}°, ${a.lon.toFixed(3)}°`;});
      marker.addTo(map); airportLayers.push(marker);
    });
    map.on("mousemove",e=>{$("coords").textContent=`${e.latlng.lat.toFixed(3)}° ${e.latlng.lat>=0?"N":"S"} · ${Math.abs(e.latlng.lng).toFixed(3)}° ${e.latlng.lng>=0?"E":"W"}`;});
    map.on("mouseout",()=>{$("coords").textContent="КАРТА МИРА · WGS84";});
    planRoute();
  }
  function clearRouteLayers() {
    if(routeLine){map.removeLayer(routeLine);routeLine=null;}
    if(routeGlow){map.removeLayer(routeGlow);routeGlow=null;}
    if(planeMarker){map.removeLayer(planeMarker);planeMarker=null;}
  }
  function updateRouteStats() {
    routeDistanceKm=distanceKm(origin,destination);
    $("distance").innerHTML=`${formatDistance(routeDistanceKm)} <small>NM</small>`;
    $("eta").textContent=formatDuration(routeDistanceKm/speed);
    $("bottomFlightRoute").textContent=`${origin.code}  →  ${destination.code}`;
    $("bottomFlightLabel").textContent=state==="flying"?"FLIGHT IN PROGRESS":state==="landed"?"FLIGHT COMPLETED":"FLIGHT PLAN / READY";
  }
  function setFlightState(next) {
    state=next;
    const labels={
      standby:["Готов к вылету","Маршрут построен — можно стартовать","STANDBY","Ⅱ"],
      flying:["Самолёт в полёте","Симуляция маршрута активна","IN FLIGHT","▶"],
      paused:["Полёт на паузе","Нажми «Продолжить полёт»","PAUSED","Ⅱ"],
      landed:["Полёт завершён","Ты прибыл в аэропорт назначения","LANDED","✓"]
    };
    const l=labels[next]; $("flightState").textContent=l[0]; $("flightSubstate").textContent=l[1]; $("statePill").textContent=l[2]; $("stateIcon").textContent=l[3];
    $("startFlight").textContent=next==="flying"?"Ⅱ Пауза":next==="paused"?"▶ Продолжить полёт":next==="landed"?"✓ Полёт завершён":"▶ Запустить полёт";
    $("startFlight").disabled=next==="landed"||!routePoints.length;
    $("progressText").textContent=`${Math.round(progress*100)}%`; $("bottomProgress").textContent=`${Math.round(progress*100)}%`; $("progressBar").style.width=`${progress*100}%`;
    $("bottomFlightLabel").textContent=next==="flying"?"FLIGHT IN PROGRESS":next==="landed"?"FLIGHT COMPLETED":"FLIGHT PLAN / READY";
  }
  function planRoute() {
    stopAnimation(); origin=getAirport(originSelect.value); destination=getAirport(destSelect.value);
    if(origin.code===destination.code){destination=airports.find(a=>a.code!==origin.code);destSelect.value=destination.code;}
    clearRouteLayers(); routePoints=buildArc(origin,destination,160).points; progress=0;elapsed=0;
    const arc=buildArc(origin,destination,160);
    arc.segments.forEach(segment=>{
      L.polyline(segment,{color:"#071426",weight:7,opacity:.7,lineCap:"round"}).addTo(map);
    });
    routeGlow=L.layerGroup(arc.segments.map(segment=>L.polyline(segment,{color:"#53e4ff",weight:3,opacity:.9,dashArray:"7 9",lineCap:"round"}))).addTo(map);
    routeLine=L.layerGroup([
      L.marker([origin.lat,origin.lon],{icon:createAirportIcon(false),zIndexOffset:500}).bindTooltip(`${origin.code} · Вылет`),
      L.marker([destination.lat,destination.lon],{icon:createAirportIcon(true),zIndexOffset:500}).bindTooltip(`${destination.code} · Назначение`)
    ]).addTo(map);
    planeMarker=L.marker([origin.lat,origin.lon],{icon:createPlaneIcon(),zIndexOffset:1000,interactive:false}).addTo(map);
    map.fitBounds(L.latLngBounds([origin.lat,origin.lon],[destination.lat,destination.lon]).pad(.25),{animate:true,duration:.7,maxZoom:5});
    updateRouteStats(); setFlightState("standby");
  }
  function stopAnimation(){if(frame!==null){cancelAnimationFrame(frame);frame=null;}lastFrame=0;}
  function tick(timestamp) {
    if(state!=="flying"){frame=null;return;}
    if(!lastFrame) lastFrame=timestamp;
    const delta=Math.min((timestamp-lastFrame)/1000,.1);lastFrame=timestamp;
    // The flight is accelerated for an enjoyable demo: a full route takes about 45–100 seconds.
    const simulatedDuration=Math.max(45,Math.min(100,routeDistanceKm/speed*18));
    elapsed+=delta;progress=Math.min(1,elapsed/simulatedDuration);
    const point=interpolateGreatCircle(origin,destination,progress);
    if(planeMarker)planeMarker.setLatLng(point);
    $("progressText").textContent=`${Math.round(progress*100)}%`;$("bottomProgress").textContent=`${Math.round(progress*100)}%`;$("progressBar").style.width=`${progress*100}%`;
    $("coords").textContent=`${point[0].toFixed(3)}° ${point[0]>=0?"N":"S"} · ${Math.abs(point[1]).toFixed(3)}° ${point[1]>=0?"E":"W"}`;
    if(progress>=1){stopAnimation();setFlightState("landed");if(planeMarker)planeMarker.setLatLng([destination.lat,destination.lon]);return;}
    frame=requestAnimationFrame(tick);
  }
  function startOrPause() {
    if(state==="standby"||state==="paused"){
      if(progress>=1)progress=0;
      elapsed=progress*Math.max(45,Math.min(100,routeDistanceKm/speed*18));
      setFlightState("flying");lastFrame=0;frame=requestAnimationFrame(tick);
    }else if(state==="flying"){stopAnimation();setFlightState("paused");}
  }
  function resetFlight(){stopAnimation();progress=0;elapsed=0;if(planeMarker)planeMarker.setLatLng([origin.lat,origin.lon]);setFlightState("standby");}
  function updateSpeed(){speed=Number(speedInput.value);$("speedValue").textContent=speed;updateRouteStats();}
  $("planRoute").addEventListener("click",planRoute);
  $("swapRoute").addEventListener("click",()=>{const old=originSelect.value;originSelect.value=destSelect.value;destSelect.value=old;planRoute();});
  originSelect.addEventListener("change",planRoute);destSelect.addEventListener("change",planRoute);
  $("startFlight").addEventListener("click",startOrPause);$("resetFlight").addEventListener("click",resetFlight);
  speedInput.addEventListener("input",updateSpeed);
  $("worldView").addEventListener("click",()=>map.setView([20,0],2,{animate:true}));
  $("toggleLabels").addEventListener("click",()=>{showAirports=!showAirports;airportLayers.forEach(layer=>showAirports?layer.addTo(map):map.removeLayer(layer));$("toggleLabels").classList.toggle("active",!showAirports);});
  function clock(){const d=new Date();$("clock").textContent=`UTC ${d.toISOString().slice(11,19)}`;}
  populateSelects();clock();setInterval(clock,1000);initMap();
})();