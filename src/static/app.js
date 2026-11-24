// Gypsos Loutraki: menu and the quote form (POST /api/lead through the site's Worker; WhatsApp, Viber and email as fallbacks).
(function () {
  var en = document.documentElement.lang === "en";
  var WA = "306906838669";
  var EMAIL = "info@gypsos-loutraki.com";

  // Google Ads: consent banner (Consent Mode v2) and conversion events.
  // Fill CONV with the conversion labels from Google Ads (Goals → Conversions → the action → Tag setup), e.g. "AbCdEf123".
  var CONV = { lead: "", call: "", whatsapp: "", viber: "", email: "" };
  function track(kind) {
    if (typeof window.gtag !== "function") return;
    if (CONV[kind] && window.ADS_ID) window.gtag("event", "conversion", { send_to: window.ADS_ID + "/" + CONV[kind] });
    window.gtag("event", kind === "lead" ? "generate_lead" : "contact", { method: kind });
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href], [data-via]");
    if (!a) return;
    var h = a.getAttribute("href") || "", via = a.dataset ? a.dataset.via : "";
    if (h.indexOf("tel:") === 0) track("call");
    else if (h.indexOf("wa.me") > -1 || via === "wa") track("whatsapp");
    else if (h.indexOf("viber:") === 0 || via === "viber") track("viber");
    else if (h.indexOf("mailto:") === 0 || via === "mail") track("email");
  });
  var stored = null;
  try { stored = localStorage.getItem("consent"); } catch (e) {}
  if (!stored) {
    var cb = document.createElement("div");
    cb.className = "cb";
    cb.setAttribute("role", "region");
    cb.setAttribute("aria-label", "Cookies");
    cb.innerHTML = "<p>" + (en
      ? "We use Google Ads cookies to measure which ads bring calls and requests. <a href=\"/en/privacy/\">Privacy</a>"
      : "Χρησιμοποιούμε cookies του Google Ads για να μετράμε ποιες διαφημίσεις φέρνουν κλήσεις και αιτήματα. <a href=\"/aporrito/\">Απόρρητο</a>") +
      "</p><div><button type=\"button\" class=\"btn btn-sm\" data-c=\"granted\">" + (en ? "Accept" : "Αποδοχή") +
      "</button><button type=\"button\" class=\"btn btn-sm btn-ghost\" data-c=\"denied\">" + (en ? "Reject" : "Απόρριψη") + "</button></div>";
    cb.addEventListener("click", function (e) {
      var b = e.target.closest("[data-c]");
      if (!b) return;
      var v = b.dataset.c;
      try { localStorage.setItem("consent", v); } catch (err) {}
      if (v === "granted" && typeof window.gtag === "function")
        window.gtag("consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" });
      cb.remove();
    });
    document.body.appendChild(cb);
  }

  // menu: close on link click, outside tap or Escape
  var menu = document.querySelector(".dd");
  if (menu) {
    menu.addEventListener("click", function (e) { if (e.target.closest(".dd-p a")) menu.open = false; });
    document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") menu.open = false; });
  }

  document.querySelectorAll(".lf").forEach(function (form) {
    var res = form.querySelector(".lf-res");
    var btn = form.querySelector("button[type=submit]");
    var L = en
      ? { name: "Name", phone: "Phone", area: "Area", type: "Work", msg: "Message",
          need: "Please fill in your name and phone.", sending: "Sending…",
          ok: "Thank you! We received your request and will call you soon.",
          fail: "The form could not be sent right now. Please send the same message with one tap:", hi: "Hello, I would like a quote for drywall work." }
      : { name: "Όνομα", phone: "Τηλέφωνο", area: "Περιοχή", type: "Εργασία", msg: "Μήνυμα",
          need: "Συμπληρώστε όνομα και τηλέφωνο.", sending: "Αποστολή…",
          ok: "Ευχαριστούμε! Λάβαμε το αίτημά σας και θα σας καλέσουμε σύντομα.",
          fail: "Η αποστολή δεν έγινε αυτή τη στιγμή. Στείλτε το ίδιο μήνυμα με ένα πάτημα:", hi: "Γεια σας, θα ήθελα προσφορά για εργασίες γυψοσανίδας." };
    function val(n) { var el = form.elements[n]; return String((el || {}).value || "").trim(); }
    function text() {
      var lines = [L.hi];
      ["name", "phone", "area", "type", "msg"].forEach(function (k) { if (val(k)) lines.push(L[k] + ": " + val(k)); });
      return lines.join("\n");
    }
    function link(via) {
      var t = encodeURIComponent(text());
      if (via === "wa") return "https://wa.me/" + WA + "?text=" + t;
      if (via === "viber") return "viber://chat?number=%2B" + WA + "&draft=" + t;
      return "mailto:" + EMAIL + "?subject=" + encodeURIComponent(en ? "Drywall quote request" : "Αίτημα προσφοράς γυψοσανίδας") + "&body=" + t;
    }
    function say(html, err) { res.hidden = false; res.className = "lf-res" + (err ? " err" : ""); res.innerHTML = html; }
    form.querySelectorAll("[data-via]").forEach(function (b) {
      b.addEventListener("click", function () { window.location.href = link(b.dataset.via); });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!val("name") || !val("phone")) { say("<p>" + L.need + "</p>", true); return; }
      var d = new FormData();
      // keys are the labels the owner reads in the email (worker.js expects Όνομα and Τηλέφωνο)
      d.append("Όνομα", val("name"));
      d.append("Τηλέφωνο", val("phone"));
      if (val("area")) d.append("Περιοχή", val("area"));
      if (val("type")) d.append("Εργασία", val("type"));
      if (val("msg")) d.append("Μήνυμα", val("msg"));
      d.append("Γλώσσα", en ? "English" : "Ελληνικά");
      d.append("Σελίδα", location.href);
      d.append("_honey", val("_honey"));
      btn.disabled = true;
      var old = btn.innerHTML;
      btn.textContent = L.sending;
      fetch("/api/lead", { method: "POST", body: d })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.success) throw 0; }); })
        .then(function () { say("<p>" + L.ok + "</p>"); form.reset(); track("lead"); })
        .catch(function () {
          say("<p>" + L.fail + "</p><a class=\"btn btn-sm\" href=\"" + link("wa") + "\">WhatsApp</a>" +
              "<a class=\"btn btn-sm btn-ghost\" href=\"" + link("viber") + "\">Viber</a>" +
              "<a class=\"btn btn-sm btn-ghost\" href=\"" + link("mail") + "\">Email</a>", true);
        })
        .then(function () { btn.disabled = false; btn.innerHTML = old; });
    });
  });
})();
