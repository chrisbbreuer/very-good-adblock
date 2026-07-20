export async function openChromeView(options: Bun.WebView.ConstructorOptions): Promise<Bun.WebView> {
  let lastError: unknown

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return new Bun.WebView(options)
    }
    catch (error) {
      lastError = error
      if (attempt < 5) await Bun.sleep(250)
    }
  }

  throw lastError
}
