import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
export async function itineraryPdf(j, tickets = []) {
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 42,
    bufferPages: true,
    info: {
      Title: "Wayline itinerary - " + j.from + " to " + j.to,
      Author: "Wayline",
      Subject: "Travel itinerary; not a carrier-issued ticket",
    },
  });
  const chunks = [];
  const done = new Promise((ok, bad) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => ok(Buffer.concat(chunks)));
    doc.on("error", bad);
  });
  doc.registerFont(
    "Body",
    fileURLToPath(new URL("../public/fonts/dm-sans-pdf.ttf", import.meta.url)),
  );
  doc.registerFont(
    "Heading",
    fileURLToPath(new URL("../public/fonts/manrope-pdf.ttf", import.meta.url)),
  );
  const ink = "#193f49",
    muted = "#526a73",
    accent = "#b74623",
    width = 528;
  const date = (value, zone = j.timezone) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(value));
  const money = (n) =>
    n == null
      ? "Not available"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: j.price.currency ?? "USD",
        }).format(n / 100);
  function ensure(height) {
    if (doc.y + height > 730) {
      doc.addPage();
      doc.y = 46;
    }
  }
  function paragraph(text, size = 10, color = ink) {
    doc
      .font("Body")
      .fontSize(size)
      .fillColor(color)
      .text(String(text), 42, doc.y, { width, lineGap: 4 });
    doc.moveDown(0.6);
  }
  function heading(text) {
    ensure(50);
    doc.moveDown(0.6);
    doc.font("Heading").fontSize(15).fillColor(ink).text(text, 42, doc.y, { width });
    doc.moveDown(0.65);
  }
  doc.rect(0, 0, 612, 158).fill(ink);
  doc.font("Heading").fontSize(23).fillColor("#ffce8f").text("Wayline", 42, 30);
  doc.font("Body").fontSize(10).fillColor("#ffffff").text("COMPLETE JOURNEY ITINERARY", 42, 65);
  doc
    .font("Heading")
    .fontSize(22)
    .text(j.from + " to " + j.to, 42, 88, { width });
  doc.y = 178;
  paragraph(
    j.dataMode === "illustrative"
      ? "SAMPLE ITINERARY - NOT VALID FOR TRAVEL"
      : "WAYLINE ITINERARY - NOT A CARRIER-ISSUED TICKET",
    10,
    accent,
  );
  paragraph(
    "Journey reference: " +
      j.id +
      "  |  Version " +
      (j.version ?? 1) +
      "  |  " +
      (j.state ?? "PLANNED"),
  );
  paragraph(
    "Departure: " + date(j.departure) + "\nArrival: " + date(j.arrival, j.destinationTimezone),
  );
  paragraph(
    j.travelers +
      " traveler(s)  |  " +
      j.durationMinutes +
      " minutes  |  " +
      j.transfers +
      " transfer(s)  |  " +
      j.walkMinutes +
      " minutes walking",
  );
  heading("Your complete itinerary");
  j.legs.forEach((leg, index) => {
    const details = [
      leg.from + " to " + leg.to,
      date(leg.departure) + " - " + date(leg.arrival),
      leg.operator + " / " + leg.service,
      leg.mode === "walk"
        ? "Walking connection"
        : leg.platform
          ? "Platform: " + leg.platform
          : "Platform: confirm with operator",
      leg.mode === "walk"
        ? "Follow the saved walking connection and station signs."
        : (leg.boardingHint ?? ""),
      leg.tracking?.observedAt
        ? "Tracking observed: " + date(leg.tracking.observedAt)
        : "Schedule information; live position not confirmed",
    ].filter(Boolean);
    doc.font("Body").fontSize(10);
    const height = doc.heightOfString(details.join("\n"), { width: width - 32, lineGap: 4 }) + 59;
    ensure(height);
    const y = doc.y;
    doc.roundedRect(42, y, width, height, 10).fill(index % 2 ? "#e8f2f5" : "#fff0df");
    doc
      .font("Heading")
      .fontSize(12)
      .fillColor(ink)
      .text(index + 1 + ". " + leg.mode.toUpperCase(), 58, y + 13, { width: width - 32 });
    doc
      .font("Body")
      .fontSize(10)
      .fillColor(ink)
      .text(details.join("\n"), 58, y + 35, { width: width - 32, lineGap: 4 });
    doc.y = y + height + 12;
  });
  heading("Fare and cost information");
  for (const item of j.price.items ?? []) {
    ensure(24);
    paragraph(item.label + ": " + money(item.cents));
  }
  paragraph("Recorded total: " + money(j.price.totalCents), 12, accent);
  paragraph(
    "Amounts are planning estimates unless identified as an imported purchase record. Verify fares, eligibility and cancellation conditions with each operator.",
    9,
    muted,
  );
  heading("Imported ticket references");
  if (!tickets.length) paragraph("No imported ticket records are attached to this journey.");
  for (const t of tickets) {
    ensure(130);
    paragraph(
      t.operator +
        " / " +
        t.service +
        "\nPassenger: " +
        t.passenger +
        "\nConfirmation: " +
        t.confirmation +
        "\nSeat: " +
        (t.seat || "Not recorded") +
        "  Coach: " +
        (t.coach || "Not recorded") +
        "\nFrom: " +
        (t.origin || "Not recorded") +
        " to " +
        (t.destination || "Not recorded") +
        "\nDeparture: " +
        (t.departure ? date(t.departure) : "Not recorded") +
        "\nSource: " +
        (t.source || "User import") +
        " - not verified by Wayline.",
    );
  }
  heading("Disruptions and travel notes");
  if (!j.disruptions?.length)
    paragraph(
      "No confirmed disruption is attached to this snapshot. Missing live data does not mean a service is on time.",
    );
  for (const d of j.disruptions ?? []) paragraph(d.title + "\n" + d.body);
  paragraph(
    "Bring your original operator-issued ticket. This itinerary does not reserve a seat, confirm a purchase, or replace a valid ticket.",
    10,
    accent,
  );
  heading("Snapshot details");
  paragraph(
    "Created: " +
      date(new Date().toISOString()) +
      "\nJourney updated: " +
      date(j.updatedAt ?? new Date().toISOString()) +
      "\nSchedule observed: " + (j.observedAt ? date(j.observedAt) : "Not recorded") +
      "\nLive observations: " + (j.liveUpdatedAt ? date(j.liveUpdatedAt) : "Not recorded") +
      "\nSource: " +
      (j.dataMode === "provider"
        ? "OpenTripPlanner / MBTA GTFS and available realtime updates"
        : "Wayline illustrative sample data") +
      "\nTimezone: " +
      j.timezone,
    9,
    muted,
  );
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.strokeColor("#d8e3e2").moveTo(42, 750).lineTo(570, 750).stroke();
    doc
      .font("Body")
      .fontSize(8)
      .fillColor(muted)
      .text("WAYLINE  /  Travel workspace", 42, 760, { lineBreak: false })
      .text("Page " + (i + 1) + " of " + pages.count, 470, 760, {
        width: 100,
        align: "right",
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
