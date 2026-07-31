// CellTonis Pharma — form submission handler.
//
// Deployment target: a Node.js serverless function at /api/submit (Vercel's
// zero-config convention for a static site — this file needs no build step
// and no framework). If you deploy elsewhere, port this single handler to
// that platform's function signature; the validation/email logic below is
// otherwise self-contained and dependency-free.
//
// Required environment variables (set in the hosting dashboard, never in
// frontend code):
//   EMAIL_API_KEY  — API key for the transactional email provider (Resend:
//                    https://resend.com). Required — sending fails without it.
//   EMAIL_FROM     — verified sender, e.g. "CellTonis Pharma <notifications@celltonispharma.uk>"
//   EMAIL_TO       — destination inbox. Defaults to alfred@celltonispharma.uk
//                    if unset, so submissions never silently go nowhere.

const EMAIL_TO = process.env.EMAIL_TO || "alfred@celltonispharma.uk";
const EMAIL_FROM = process.env.EMAIL_FROM || "CellTonis Pharma <onboarding@resend.dev>";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = new Map();

const NETWORK_FIELDS = [
  { key: "fullName", label: "Name", required: true },
  { key: "businessName", label: "Business", required: true },
  { key: "role", label: "Role", required: false },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone", required: true },
  { key: "country", label: "Country", required: true },
  { key: "city", label: "City", required: false },
  { key: "businessType", label: "Business Type", required: true },
  { key: "interests", label: "Interest", required: true, isArray: true },
  { key: "monthlyVolume", label: "Monthly Purchasing Requirement", required: false },
  { key: "products", label: "Products", required: false },
  { key: "message", label: "Additional Information", required: false, multiline: true }
];

const PARTNER_FIELDS = [
  { key: "fullName", label: "Name", required: true },
  { key: "company", label: "Company", required: true },
  { key: "role", label: "Role", required: false },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "phone", label: "Phone", required: true },
  { key: "country", label: "Country", required: true },
  { key: "businessType", label: "Business Type", required: true },
  { key: "currentMarkets", label: "Current Markets", required: false },
  { key: "productInterest", label: "Product Interest", required: false },
  { key: "message", label: "Additional Information", required: false, multiline: true }
];

const CONTACT_FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "company", label: "Company", required: false },
  { key: "email", label: "Email", required: true, type: "email" },
  { key: "enquiryType", label: "Enquiry Type", required: true },
  { key: "message", label: "Message", required: true, multiline: true }
];

const FORM_CONFIG = {
  "network-application": {
    title: "CELLTONIS PHARMA — NEW NETWORK APPLICATION",
    fields: NETWORK_FIELDS,
    subject: (v) => `New CellTonis Network Application — ${v.businessName}`
  },
  "partner-enquiry": {
    title: "CELLTONIS PHARMA — NEW DISTRIBUTION PARTNER ENQUIRY",
    fields: PARTNER_FIELDS,
    subject: (v) => `New CellTonis Website Enquiry — Distribution Partner (${v.company})`
  },
  "general-contact": {
    title: "CELLTONIS PHARMA — NEW WEBSITE ENQUIRY",
    fields: CONTACT_FIELDS,
    subject: (v) => `New CellTonis Website Enquiry — ${v.enquiryType || "General"}`
  }
};

function clean(value, options) {
  options = options || {};
  var maxLength = options.maxLength || 300;
  var multiline = !!options.multiline;

  if (typeof value !== "string") return "";
  var v = value.normalize("NFKC").trim();
  v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // strip control chars
  v = multiline ? v.replace(/\r\n/g, "\n") : v.replace(/[\r\n]+/g, " ");
  if (v.length > maxLength) v = v.slice(0, maxLength);
  return v;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function getClientIp(req) {
  var fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function isRateLimited(ip) {
  var now = Date.now();
  var timestamps = (rateLimitStore.get(ip) || []).filter(function (t) {
    return now - t < RATE_LIMIT_WINDOW_MS;
  });
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

function processFields(fieldDefs, body) {
  var values = {};
  var missing = [];

  fieldDefs.forEach(function (def) {
    if (def.isArray) {
      var arr = Array.isArray(body[def.key]) ? body[def.key] : [];
      arr = arr.map(function (v) { return clean(String(v), { maxLength: 80 }); }).filter(Boolean).slice(0, 10);
      values[def.key] = arr;
      if (def.required && arr.length === 0) missing.push(def.label);
      return;
    }

    var raw = body[def.key];
    var cleaned = clean(typeof raw === "string" ? raw : "", {
      maxLength: def.multiline ? 4000 : 300,
      multiline: !!def.multiline
    });
    values[def.key] = cleaned;

    if (def.required && !cleaned) missing.push(def.label);
    if (def.type === "email" && cleaned && !isValidEmail(cleaned)) missing.push(def.label + " (invalid format)");
  });

  return { values: values, missing: missing };
}

function buildEmailText(title, fieldDefs, values, submittedAt, enquiryType) {
  var lines = [title, "", "Submitted: " + submittedAt, "Enquiry type: " + enquiryType, ""];
  fieldDefs.forEach(function (def) {
    var v = def.isArray ? values[def.key].join(", ") : values[def.key];
    lines.push(def.label + ": " + (v || "—"));
  });
  return lines.join("\n");
}

async function sendEmail(payload) {
  var apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) {
    throw new Error("EMAIL_API_KEY is not configured on the server.");
  }

  var response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      reply_to: payload.replyTo || undefined,
      subject: payload.subject,
      text: payload.text
    })
  });

  if (!response.ok) {
    var errBody = await response.text().catch(function () { return ""; });
    throw new Error("Email provider responded with " + response.status + ": " + errBody);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  var body = req.body;
  if (!body || typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch (e) {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  // Honeypot — bots that fill every field trip this; humans never see it.
  if (clean(body.website || "", { maxLength: 100 })) {
    return res.status(200).json({ ok: true });
  }

  var formType = clean(body.formType || "", { maxLength: 40 });
  var config = FORM_CONFIG[formType];
  if (!config) {
    return res.status(400).json({ ok: false, error: "Invalid form type." });
  }

  var ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: "Too many submissions. Please try again in a few minutes." });
  }

  var result = processFields(config.fields, body);
  if (result.missing.length) {
    return res.status(400).json({ ok: false, error: "Please check: " + result.missing.join(", ") });
  }

  var submittedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  var enquiryLabel = formType === "network-application"
    ? "Network Application"
    : formType === "partner-enquiry"
      ? "Distribution Partner Enquiry"
      : (result.values.enquiryType || "General Enquiry");

  var text = buildEmailText(config.title, config.fields, result.values, submittedAt, enquiryLabel);
  var subject = config.subject(result.values);
  var replyToEmail = result.values.email;

  try {
    await sendEmail({
      subject: subject,
      text: text,
      replyTo: replyToEmail && isValidEmail(replyToEmail) ? replyToEmail : undefined
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("CellTonis form submission failed:", err);
    return res.status(502).json({ ok: false, error: "We could not send your submission. Please try again shortly." });
  }
};
