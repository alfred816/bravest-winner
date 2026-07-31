(function () {
  "use strict";

  var lastFocused = null;
  var openModalEl = null;

  function getFocusable(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) { return el.offsetParent !== null; });
  }

  function openModal(name) {
    var modal = document.querySelector('.modal[data-modal="' + name + '"]');
    if (!modal) return;

    lastFocused = document.activeElement;
    openModalEl = modal;

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    // force reflow so the transition runs, then trigger visible state
    void modal.offsetWidth;
    requestAnimationFrame(function () {
      modal.classList.add("is-visible");
    });

    var focusable = getFocusable(modal.querySelector(".modal-panel"));
    if (focusable.length) focusable[0].focus();

    document.addEventListener("keydown", onKeydown, true);
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove("is-visible");
    document.removeEventListener("keydown", onKeydown, true);

    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      openModalEl = null;
      resetModalView(modal);
    };

    var panel = modal.querySelector(".modal-panel");
    panel.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 450); // safety fallback if transitionend doesn't fire
  }

  function resetModalView(modal) {
    var body = modal.querySelector("[data-modal-body]");
    var success = modal.querySelector("[data-modal-success]");
    if (!body || !success || success.hidden) return;

    success.hidden = true;
    body.hidden = false;

    var form = modal.querySelector("form");
    if (!form) return;
    form.reset();
    form.querySelectorAll(".field, .field-fieldset").forEach(function (f) {
      f.classList.remove("has-error");
    });
    var banner = form.querySelector("[data-form-error]");
    if (banner) banner.hidden = true;
  }

  function onKeydown(e) {
    if (!openModalEl) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeModal(openModalEl);
      return;
    }

    if (e.key === "Tab") {
      var panel = openModalEl.querySelector(".modal-panel");
      var focusable = getFocusable(panel);
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-modal-open]");
    if (opener) {
      e.preventDefault();
      openModal(opener.getAttribute("data-modal-open"));
      return;
    }

    var closer = e.target.closest("[data-modal-close]");
    if (closer) {
      var modal = closer.closest(".modal");
      closeModal(modal);
    }
  });

  /* ======================================================================
     Form validation + submission
     ====================================================================== */

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setFieldError(field, message) {
    field.classList.toggle("has-error", !!message);
    var errorEl = field.querySelector("[data-error]");
    if (errorEl) errorEl.textContent = message || "";
  }

  function validateForm(form) {
    var firstInvalid = null;
    var valid = true;

    form.querySelectorAll(".field").forEach(function (field) {
      var input = field.querySelector("input:not([type=checkbox]), select, textarea");
      if (!input) return;

      var message = "";
      if (input.hasAttribute("required") && !input.value.trim()) {
        message = "This field is required.";
      } else if (input.type === "email" && input.value.trim() && !EMAIL_RE.test(input.value.trim())) {
        message = "Enter a valid email address.";
      }

      setFieldError(field, message);
      if (message) {
        valid = false;
        if (!firstInvalid) firstInvalid = input;
      }
    });

    var fieldset = form.querySelector(".field-fieldset");
    if (fieldset) {
      var checked = fieldset.querySelectorAll('input[type="checkbox"]:checked');
      var message = checked.length === 0 ? "Select at least one option." : "";
      fieldset.classList.toggle("has-error", !!message);
      var errorEl = fieldset.querySelector("[data-error]");
      if (errorEl) errorEl.textContent = message;
      if (message) {
        valid = false;
        if (!firstInvalid) firstInvalid = fieldset.querySelector('input[type="checkbox"]');
      }
    }

    if (firstInvalid) firstInvalid.focus();
    return valid;
  }

  function clearFieldErrorOnInput(form) {
    form.querySelectorAll("input, select, textarea").forEach(function (input) {
      var handler = function () {
        var field = input.closest(".field") || input.closest(".field-fieldset");
        if (field) setFieldError(field, "");
      };
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    });
  }

  function serializeForm(form) {
    var data = {};
    var formData = new FormData(form);
    var interests = formData.getAll("interests");

    formData.forEach(function (value, key) {
      if (key === "interests") return;
      data[key] = typeof value === "string" ? value : "";
    });

    if (interests.length) data.interests = interests;
    return data;
  }

  function showFormError(form, message) {
    var banner = form.querySelector("[data-form-error]");
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
  }

  function hideFormError(form) {
    var banner = form.querySelector("[data-form-error]");
    if (banner) banner.hidden = true;
  }

  function setLoading(button, loading) {
    button.classList.toggle("is-loading", loading);
    button.disabled = loading;
  }

  document.querySelectorAll(".app-form").forEach(function (form) {
    clearFieldErrorOnInput(form);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hideFormError(form);

      if (!validateForm(form)) return;

      var submitBtn = form.querySelector("[data-submit]");
      setLoading(submitBtn, true);

      var payload = serializeForm(form);
      payload.formType = form.getAttribute("data-form");

      fetch("/api/submit.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (json) {
            return { ok: res.ok && json.ok !== false, status: res.status, json: json };
          });
        })
        .then(function (result) {
          setLoading(submitBtn, false);
          if (!result.ok) {
            showFormError(form, (result.json && result.json.error) || "We couldn't submit this right now. Please try again or contact us directly.");
            return;
          }

          var modal = form.closest(".modal");
          var body = modal.querySelector("[data-modal-body]");
          var success = modal.querySelector("[data-modal-success]");
          if (body && success) {
            body.hidden = true;
            success.hidden = false;
            var focusTarget = success.querySelector("button");
            if (focusTarget) focusTarget.focus();
          }
        })
        .catch(function () {
          setLoading(submitBtn, false);
          showFormError(form, "We couldn't reach the server. Please check your connection and try again, or email us directly.");
        });
    });
  });
})();
