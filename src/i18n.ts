// Phase 7 (roadmap features 93/94, "Multilingual support" and "Visitor mode"): a real i18n
// resource catalog plus locale-aware date/number/currency formatting, replacing the earlier
// approach where only the nav labels and four hardcoded phrasebook phrases had translations
// and every other string in the app was English-only regardless of `preferences.language`.
//
// `es` is a genuine starter locale intended to cover real UI surfaces (see the pages that call
// `t()` below); `hi` currently only covers navigation and the phrasebook, exactly as before this
// pass -- everywhere else falls back to English. Every non-English string here was translated by
// this assistant, not a certified translation service or a native-speaker reviewer, so it is
// labeled that way in the UI (see `phrasebook.unreviewedNote` and README.md's "Known gaps") --
// translation QUALITY review is a human task this pass cannot certify, exactly like the roadmap
// itself flags for feature 93.

export type Locale = "en" | "es" | "hi";

export const SUPPORTED_LOCALES: Locale[] = ["en", "es", "hi"];

// Full-UI locales: everything under app.*/nav.*/planner.*/phrasebook.* is covered. Locales not
// listed here (currently just "hi") still work for navigation and the phrasebook -- see above.
export const FULL_UI_LOCALES: Locale[] = ["en", "es"];

export const localeTags: Record<Locale, string> = {
  en: "en-US",
  es: "es-US",
  hi: "hi-IN",
};

type Table = Record<string, string>;

const en: Table = {
  "nav.assistant": "Assistant", "nav.more": "More", "nav.planShort": "Plan", "nav.tripsShort": "Journeys",
  "nav.plan": "Plan a journey",
  "nav.guardian": "Journey Guardian",
  "nav.tickets": "Tickets",
  "nav.inbox": "Journey inbox",
  "nav.trips": "My journeys",
  "nav.commute": "Commute",
  "nav.profile": "Profile & preferences",
  "nav.lab": "Open Transit Lab",

  "app.footerTagline": "Travel workspace",
  "app.footerNote": "Sample routes are for planning, not valid tickets.",
  "app.brandAria": "Wayline home",
  "app.watchBadge": "GLANCE VIEW · WEB",
  "app.scheduledArrival": "Scheduled arrival · {tz}",
  "app.overallRisk": "{risk} modeled connection risk",
  "app.sampleJourney": "Sample journey",
  "app.connectedSchedule": "Connected schedule",
  "app.fullJourney": "Full journey",
  "app.noSavedJourneyTitle": "No saved journey",
  "app.noSavedJourneyBody": "Save a trip to use the glance view.",
  "app.notNativeApp": "This compact web view is not a native Apple Watch or Wear OS application.",
  "app.openAgentAria": "Open journey assistant",
  "app.dismissNotificationAria": "Dismiss notification",
  "app.phrasebookTitle": "A few words for the journey",
  "app.tapToHear": "Tap to hear",

  "phrasebook.categoryAlerts": "Transit alerts",
  "phrasebook.categoryStation": "Station instructions",
  "phrasebook.categoryTicketing": "Ticketing",
  "phrasebook.categoryBoarding": "Boarding directions",
  "phrasebook.unreviewedNote":
    "These phrases are AI-translated and have not been reviewed by a native speaker.",
  "phrasebook.alerts.1": "Is my train delayed?",
  "phrasebook.alerts.2": "Has anything changed with my trip?",
  "phrasebook.alerts.3": "Where can I get help right now?",
  "phrasebook.station.1": "Which platform is my train on?",
  "phrasebook.station.2": "Is there a step-free entrance?",
  "phrasebook.station.3": "Where is the nearest elevator?",
  "phrasebook.ticketing.1": "Where do I buy a ticket?",
  "phrasebook.ticketing.2": "Does this ticket work on this bus?",
  "phrasebook.ticketing.3": "I need a paper ticket, not a phone ticket.",
  "phrasebook.boarding.1": "Where does this bus go?",
  "phrasebook.boarding.2": "Can you help me find my connection?",
  "phrasebook.boarding.3": "Is this the right platform for my train?",

  "planner.heading": "Where to next?",
  "planner.subheading": "Find a route for your next little adventure.",
  "planner.assistantBadge": "Plan with Assistant",
  "planner.from": "From",
  "planner.swapTitle": "Swap origin and destination",
  "planner.to": "To",
  "planner.departureLabel": "Departure · your device time",
  "planner.searching": "Searching…",
  "planner.findJourneys": "Find journeys",
  "planner.travelers": "Travelers",
  "planner.travelerCountOne": "{n} traveler",
  "planner.travelerCountMany": "{n} travelers",
  "planner.totalBudget": "Total budget",
  "planner.schedules": "Schedules",
  "planner.sampleRoutes": "Explore sample routes",
  "planner.connectedSchedules": "Connected regional schedules",
  "planner.hidePreferences": "Hide preferences",
  "planner.tripPreferences": "Trip preferences",
  "planner.airportDeadline": "Airport deadline",
  "planner.meetTogether": "Meet together",
  "planner.arriveByLabel": "Arrive by · your device time",
  "planner.tripImportance": "Trip importance",
  "planner.importance.casual": "Casual",
  "planner.importance.normal": "Normal",
  "planner.importance.important": "Important",
  "planner.importance.critical": "Critical",
  "planner.maxTransfers": "Maximum transfers",
  "planner.maxWalking": "Maximum walking (min)",
  "planner.connectionBuffer": "Connection buffer (min)",
  "planner.extraBags": "Extra bags",
  "planner.riskTolerance": "Risk tolerance",
  "planner.risk.conservative": "Conservative",
  "planner.risk.balanced": "Balanced",
  "planner.risk.aggressive": "Aggressive",
  "planner.weatherScenario": "Weather scenario",
  "planner.weather.clear": "Clear",
  "planner.weather.rain": "Rain",
  "planner.weather.snow": "Snow",
  "planner.weather.heat": "Heat",
  "planner.stepFreeRoute": "Step-free route",
  "planner.preferMoreSpace": "Prefer more space",
  "planner.avoidBuses": "Avoid buses",
  "planner.preferTrains": "Prefer trains",
  "planner.elevatorOutage": "Model an elevator outage",
  "planner.elevatorOutageDesc": "Scenario only; affects accessible transfer options.",
  "planner.askPlaceholder":
    "Or just ask: get me to San Jose under $75, with a comfortable transfer",
  "planner.askAria": "Ask the journey assistant",
  "planner.quickRoutes": "QUICK ROUTES",
  "planner.saveRoute": "Save this route",
  "planner.findEyebrow": "LET’S FIND YOUR WAY",
  "planner.waysToGetThere": "{n} route options",
  "planner.findingJourney": "Finding your journey…",
  "planner.sort.balanced": "Recommended",
  "planner.sort.price": "Cheapest",
  "planner.sort.fastest": "Fastest",
  "planner.sort.reliable": "More reliable",
  "planner.sampleNote": "Sample schedules, fares and scores · no tickets issued",
  "planner.noRouteTitle": "No route meets every preference",
  "planner.excludedCount": "{n} options excluded by your preferences",
  "planner.glanceTitle": "Your journey, at a glance",
  "planner.doorToDoor": "door to door",
  "planner.connections": "connections",
  "planner.sampleReliability": "sample reliability",
  "planner.doorToDoorTotal": "Door-to-door total",
  "planner.privateTrip": "Private trip",
  "planner.privateTripDesc": "Automatically removed after completion or expiry.",
  "planner.saveAndFollow": "Save journey & follow",
  "planner.savePlansTrip": "Saving plans your trip. Buy tickets directly from each operator.",
  "planner.willAppearTitle": "Your journey will appear here",
  "planner.willAppearBody": "Choose a route to inspect each connection.",
  "planner.savedNotify": "Journey saved. You can now follow it in Journey Guardian.",
  "planner.shortcutSaved": "Shortcut saved.",
  "planner.airportApplied": "Airport arrival deadline applied. Run your search to compare routes.",
  "planner.meetingApplied":
    "Meeting point and group size applied. Verify each approach separately.",
  "planner.airportTitle": "Make the flight, with time to spare",
  "planner.airportIntro": "Work backward from your flight to a ground-transport arrival deadline.",
  "planner.flightDepartureLabel": "Flight departure · your device time",
  "planner.terminalAllowanceLabel": "Terminal transfer allowance (min)",
  "planner.internationalFlight": "International flight",
  "planner.checkingBaggage": "Checking baggage",
  "planner.airportNotice":
    "Includes a planning allowance of {minutes} minutes, plus your terminal transfer{baggage}. No flight status or live security queue is connected.",
  "planner.baggageExtra": " and 30 minutes for baggage",
  "planner.applyDeadline": "Apply arrival deadline",
  "planner.groupTitle": "Different starts. One meeting point.",
  "planner.groupIntro":
    "Compare a shared station for up to six people. These distance-based estimates are for early coordination, not departure planning.",
  "planner.travelerStartsIn": "Traveler {n} starts in",
  "planner.addTraveler": "Add traveler",
  "planner.compareMeetingPoints": "Compare meeting points",
  "planner.shortestApproach": "Shortest longest approach",
  "planner.alternative": "Alternative",
  "planner.personEstimate": "Person {n}: ~{duration}",
  "planner.useStation": "Use station",
  "planner.fareUnknown": "Fare unknown",
};

const es: Table = {
  "nav.assistant": "Asistente", "nav.more": "Más", "nav.planShort": "Planificar", "nav.tripsShort": "Viajes",
  "nav.plan": "Planificar viaje",
  "nav.guardian": "Guardián del viaje",
  "nav.tickets": "Billetes",
  "nav.inbox": "Notificaciones",
  "nav.trips": "Mis viajes",
  "nav.commute": "Trayecto habitual",
  "nav.profile": "Perfil y preferencias",
  "nav.lab": "Datos de transporte",

  "app.footerTagline": "Espacio de viajes",
  "app.footerNote": "Las rutas de muestra sirven para planificar; no son boletos válidos.",
  "app.brandAria": "Inicio de Wayline",
  "app.watchBadge": "VISTA RÁPIDA · WEB",
  "app.scheduledArrival": "Llegada programada · {tz}",
  "app.overallRisk": "riesgo de conexión modelado: {risk}",
  "app.sampleJourney": "Viaje de muestra",
  "app.connectedSchedule": "Horario conectado",
  "app.fullJourney": "Viaje completo",
  "app.noSavedJourneyTitle": "Sin viaje guardado",
  "app.noSavedJourneyBody": "Guarda un viaje para usar la vista rápida.",
  "app.notNativeApp":
    "Esta vista web compacta no es una aplicación nativa de Apple Watch o Wear OS.",
  "app.openAgentAria": "Abrir asistente de viaje",
  "app.dismissNotificationAria": "Descartar notificación",
  "app.phrasebookTitle": "Algunas palabras para el viaje",
  "app.tapToHear": "Toca para escuchar",

  "phrasebook.categoryAlerts": "Alertas de tránsito",
  "phrasebook.categoryStation": "Instrucciones de la estación",
  "phrasebook.categoryTicketing": "Boletos",
  "phrasebook.categoryBoarding": "Instrucciones de abordaje",
  "phrasebook.unreviewedNote":
    "Estas frases están traducidas por IA y no han sido revisadas por un hablante nativo.",
  "phrasebook.alerts.1": "¿Mi tren está retrasado?",
  "phrasebook.alerts.2": "¿Ha cambiado algo en mi viaje?",
  "phrasebook.alerts.3": "¿Dónde puedo obtener ayuda ahora mismo?",
  "phrasebook.station.1": "¿En qué andén está mi tren?",
  "phrasebook.station.2": "¿Hay una entrada sin escaleras?",
  "phrasebook.station.3": "¿Dónde está el ascensor más cercano?",
  "phrasebook.ticketing.1": "¿Dónde compro un boleto?",
  "phrasebook.ticketing.2": "¿Este boleto sirve para este autobús?",
  "phrasebook.ticketing.3": "Necesito un boleto de papel, no un boleto en el teléfono.",
  "phrasebook.boarding.1": "¿A dónde va este autobús?",
  "phrasebook.boarding.2": "¿Puede ayudarme a encontrar mi conexión?",
  "phrasebook.boarding.3": "¿Es este el andén correcto para mi tren?",

  "planner.heading": "¿A dónde vamos?",
  "planner.subheading": "Encuentra una ruta para tu próxima aventura.",
  "planner.assistantBadge": "Asistente de viaje",
  "planner.from": "Desde",
  "planner.swapTitle": "Intercambiar origen y destino",
  "planner.to": "Hasta",
  "planner.departureLabel": "Salida · hora de tu dispositivo",
  "planner.searching": "Buscando…",
  "planner.findJourneys": "Buscar viajes",
  "planner.travelers": "Viajeros",
  "planner.travelerCountOne": "{n} viajero",
  "planner.travelerCountMany": "{n} viajeros",
  "planner.totalBudget": "Presupuesto total",
  "planner.schedules": "Horarios",
  "planner.sampleRoutes": "Explorar rutas de muestra",
  "planner.connectedSchedules": "Horarios regionales conectados",
  "planner.hidePreferences": "Ocultar preferencias",
  "planner.tripPreferences": "Preferencias del viaje",
  "planner.airportDeadline": "Límite de aeropuerto",
  "planner.meetTogether": "Reunirse",
  "planner.arriveByLabel": "Llegar antes de · hora de tu dispositivo",
  "planner.tripImportance": "Importancia del viaje",
  "planner.importance.casual": "Informal",
  "planner.importance.normal": "Normal",
  "planner.importance.important": "Importante",
  "planner.importance.critical": "Crítico",
  "planner.maxTransfers": "Máximo de transbordos",
  "planner.maxWalking": "Caminata máxima (min)",
  "planner.connectionBuffer": "Margen de conexión (min)",
  "planner.extraBags": "Equipaje adicional",
  "planner.riskTolerance": "Tolerancia al riesgo",
  "planner.risk.conservative": "Conservador",
  "planner.risk.balanced": "Equilibrado",
  "planner.risk.aggressive": "Arriesgado",
  "planner.weatherScenario": "Escenario climático",
  "planner.weather.clear": "Despejado",
  "planner.weather.rain": "Lluvia",
  "planner.weather.snow": "Nieve",
  "planner.weather.heat": "Calor",
  "planner.stepFreeRoute": "Ruta sin escalones",
  "planner.preferMoreSpace": "Preferir más espacio",
  "planner.avoidBuses": "Evitar autobuses",
  "planner.preferTrains": "Preferir trenes",
  "planner.elevatorOutage": "Simular falla de ascensor",
  "planner.elevatorOutageDesc": "Solo un escenario; afecta las opciones de transbordo accesibles.",
  "planner.askPlaceholder":
    "O simplemente pregunta: llévame a San José por menos de $75, con una conexión cómoda",
  "planner.askAria": "Preguntar al asistente de viaje",
  "planner.quickRoutes": "RUTAS RÁPIDAS",
  "planner.saveRoute": "Guardar esta ruta",
  "planner.findEyebrow": "ENCONTREMOS TU CAMINO",
  "planner.waysToGetThere": "{n} opciones de ruta",
  "planner.findingJourney": "Buscando tu viaje…",
  "planner.sort.balanced": "Recomendado",
  "planner.sort.price": "Más económico",
  "planner.sort.fastest": "Más rápido",
  "planner.sort.reliable": "Más confiable",
  "planner.sampleNote": "Horarios, tarifas y puntuaciones de muestra · no se emiten boletos",
  "planner.noRouteTitle": "Ninguna ruta cumple con todas tus preferencias",
  "planner.excludedCount": "{n} opciones excluidas por tus preferencias",
  "planner.glanceTitle": "Tu viaje, de un vistazo",
  "planner.doorToDoor": "de puerta a puerta",
  "planner.connections": "conexiones",
  "planner.sampleReliability": "confiabilidad de muestra",
  "planner.doorToDoorTotal": "Total de puerta a puerta",
  "planner.privateTrip": "Viaje privado",
  "planner.privateTripDesc": "Se elimina automáticamente al finalizar o vencer.",
  "planner.saveAndFollow": "Guardar viaje y seguir",
  "planner.savePlansTrip":
    "Guardar planifica tu viaje. Compra los boletos directamente con cada operador.",
  "planner.willAppearTitle": "Tu viaje aparecerá aquí",
  "planner.willAppearBody": "Elige una ruta para revisar cada conexión.",
  "planner.savedNotify": "Viaje guardado. Ahora puedes seguirlo en Guardián del viaje.",
  "planner.shortcutSaved": "Acceso rápido guardado.",
  "planner.airportApplied":
    "Se aplicó el límite de llegada al aeropuerto. Ejecuta tu búsqueda para comparar rutas.",
  "planner.meetingApplied":
    "Se aplicaron el punto de encuentro y el tamaño del grupo. Verifica cada trayecto por separado.",
  "planner.airportTitle": "Toma el vuelo, con tiempo de sobra",
  "planner.airportIntro":
    "Calcula hacia atrás desde tu vuelo hasta un límite de llegada por transporte terrestre.",
  "planner.flightDepartureLabel": "Salida del vuelo · hora de tu dispositivo",
  "planner.terminalAllowanceLabel": "Margen de traslado en la terminal (min)",
  "planner.internationalFlight": "Vuelo internacional",
  "planner.checkingBaggage": "Registro de equipaje",
  "planner.airportNotice":
    "Incluye un margen de planificación de {minutes} minutos, además de tu traslado en la terminal{baggage}. No hay estado de vuelo ni fila de seguridad en vivo conectados.",
  "planner.baggageExtra": " y 30 minutos para el equipaje",
  "planner.applyDeadline": "Aplicar límite de llegada",
  "planner.groupTitle": "Distintos puntos de partida. Un solo punto de encuentro.",
  "planner.groupIntro":
    "Compara una estación compartida para hasta seis personas. Estas estimaciones basadas en la distancia son para coordinación temprana, no para planificar la salida.",
  "planner.travelerStartsIn": "El viajero {n} sale desde",
  "planner.addTraveler": "Agregar viajero",
  "planner.compareMeetingPoints": "Comparar puntos de encuentro",
  "planner.shortestApproach": "Trayecto más largo, el más corto",
  "planner.alternative": "Alternativa",
  "planner.personEstimate": "Persona {n}: ~{duration}",
  "planner.useStation": "Usar estación",
  "planner.fareUnknown": "Tarifa desconocida",
};

const hi: Table = {
  "nav.assistant": "सहायक", "nav.more": "अधिक", "nav.planShort": "योजना", "nav.tripsShort": "यात्राएँ",
  "nav.plan": "यात्रा की योजना",
  "nav.guardian": "यात्रा सहायक",
  "nav.tickets": "टिकट",
  "nav.inbox": "यात्रा सूचनाएँ",
  "nav.trips": "मेरी यात्राएँ",
  "nav.commute": "दैनिक यात्रा",
  "nav.profile": "प्रोफ़ाइल",
  "nav.lab": "परिवहन डेटा",

  "phrasebook.categoryAlerts": "यात्रा चेतावनियाँ",
  "phrasebook.categoryStation": "स्टेशन निर्देश",
  "phrasebook.categoryTicketing": "टिकट",
  "phrasebook.categoryBoarding": "सवारी निर्देश",
  "phrasebook.unreviewedNote":
    "ये वाक्य एआई द्वारा अनुवादित हैं और किसी मूल भाषी द्वारा जाँचे नहीं गए हैं।",
  "phrasebook.alerts.1": "क्या मेरी ट्रेन लेट है?",
  "phrasebook.alerts.2": "क्या मेरी यात्रा में कुछ बदला है?",
  "phrasebook.alerts.3": "मुझे अभी मदद कहाँ मिल सकती है?",
  "phrasebook.station.1": "मेरी ट्रेन किस प्लेटफ़ॉर्म पर है?",
  "phrasebook.station.2": "क्या बिना सीढ़ियों वाला प्रवेश द्वार है?",
  "phrasebook.station.3": "सबसे नज़दीकी लिफ़्ट कहाँ है?",
  "phrasebook.ticketing.1": "मुझे टिकट कहाँ से खरीदना है?",
  "phrasebook.ticketing.2": "क्या यह टिकट इस बस के लिए काम करता है?",
  "phrasebook.ticketing.3": "मुझे कागज़ी टिकट चाहिए, फ़ोन टिकट नहीं।",
  "phrasebook.boarding.1": "यह बस कहाँ जाती है?",
  "phrasebook.boarding.2": "क्या आप मेरी अगली सवारी ढूँढ़ने में मदद कर सकते हैं?",
  "phrasebook.boarding.3": "क्या यह मेरी ट्रेन के लिए सही प्लेटफ़ॉर्म है?",
};

export const resources: Record<Locale, Table> = { en, es, hi };

// Every key is looked up in the requested locale, then English, then finally returned as the
// bare key itself -- so a missing translation is visibly wrong (easy to spot and file) rather
// than silently blank or a thrown error that would take down the page.
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const table = resources[locale] ?? en;
  let template = table[key] ?? en[key] ?? key;
  if (vars)
    for (const [k, v] of Object.entries(vars)) template = template.replaceAll(`{${k}}`, String(v));
  return template;
}

export function formatDate(
  locale: Locale,
  iso: string | number | Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(localeTags[locale] ?? localeTags.en, opts).format(new Date(iso));
}

export function formatDateTime(
  locale: Locale,
  iso: string | number | Date,
  timeZone?: string,
): string {
  return new Intl.DateTimeFormat(localeTags[locale] ?? localeTags.en, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatNumber(locale: Locale, n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTags[locale] ?? localeTags.en, opts).format(n);
}

export function formatCurrencyCents(
  locale: Locale,
  cents: number | null | undefined,
  currency = "USD",
): string | null {
  if (cents == null) return null;
  return new Intl.NumberFormat(localeTags[locale] ?? localeTags.en, {
    style: "currency",
    currency,
  }).format(cents / 100);
}
