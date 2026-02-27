# Form Prefill (flat GET + optional payload)

A tiny framework-agnostic JavaScript plugin that prefills HTML forms from:

![npm version](https://img.shields.io/npm/v/form-prefill)
![license](https://img.shields.io/npm/l/form-prefill)
![size](https://img.shields.io/bundlephobia/minzip/form-prefill)

- **Flat GET params** (highest priority): `?name=...&email=...&message=...`
- Optional **payload**: `?payload=<base64url(JSON)>`

Payload supports a minimal mustache-like replacement in `fields` values: `{{var}}`  
Variables can be overridden via query params: `v_<key>=...`

## Why

- Opt-in at the form level: `form[data-prefill="1"]`
- Opt-in at the field level: `data-prefill-key="..."`
- Safe assignment (`.value` only, never `innerHTML`)
- Length limits + payload caps to reduce abuse potential

---

## Install

Copy `src/form-prefill.js` into your project, or use the built file in `dist/`.

## Usage

```html
<form data-prefill="1" data-prefill-overwrite="0">
  <input name="name" data-prefill-key="name">
  <input name="email" data-prefill-key="email">
  <input name="subject" data-prefill-key="subject">
  <textarea name="message" data-prefill-key="message"></textarea>
</form>

<script src="./dist/form-prefill.js"></script>
<script>
  FormPrefill.init();
</script>
```

### Overwrite mode

By default the plugin only fills empty fields.  
To overwrite existing values:

```html
<form data-prefill="1" data-prefill-overwrite="1">
```

---

## URL examples

### Flat params

```
/examples/basic.html?name=Pawel&email=test%40example.com&message=Line%201%0ALine%202
```

### Payload (base64url JSON)

Payload JSON:

```json
{
  "vars": { "project": "K8s" },
  "fields": {
    "subject": "Inquiry about {{project}}",
    "message": "Hi {{name}},\n\nLet's talk about {{project}}."
  }
}
```

URL:

```
/examples/basic.html?payload=<base64url>&v_project=Kubernetes&name=Pawel
```

Notes:
- Flat params always win for the same field.
- `v_<key>` overrides variables used by `{{key}}`.
- `name=...` also becomes available as `{{name}}`.

---

## Payload format

```ts
type Payload = {
  vars?: Record<string, string>;
  fields?: Record<string, string>;
}
```

---

## Security notes

- Only fills fields explicitly marked with `data-prefill-key`.
- Recommended: keep server-side validation as the source of truth.
- Do not use prefilled data directly in email headers without strict validation.

---

## Development

This repo keeps it simple: no build tools required.

---

## License

MIT

## Snippets

See `docs/snippets.md`.

## Minified build

Use `dist/form-prefill.min.js` if you prefer a smaller file.

## CLI helpers

- Node: `bin/make-payload.js`
- PHP: `bin/make-payload.php`
