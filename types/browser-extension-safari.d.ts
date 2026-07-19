/**
 * Type shim for the Safari build config. `config/extension.ts` declares
 * `safariBundleId` / `safariExclude`, which buddy's `extension:safari:*`
 * commands read at runtime, but @stacksjs/browser-extension 0.70.73 does not
 * declare them on `ExtensionConfig` yet, so the repo fails `tsc --noEmit`.
 *
 * Safe to keep once the fields land upstream (interface merging of identical
 * optional members is a no-op); delete this file whenever convenient after
 * the dependency declares them natively.
 */
declare module '@stacksjs/browser-extension' {
  interface ExtensionConfig {
    /** Bundle identifier of the Safari container app (e.g. org.example.App). */
    safariBundleId?: string
    /** dist entries the Safari app build excludes (marketing-site-only pages). */
    safariExclude?: string[]
  }
}

export {}
