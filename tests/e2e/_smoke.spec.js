const { test, expect } = require("./base");
const F = require("../support/fixtures");
test("smoke e2e", async ({ app, page }) => {
  await app.abrir({ seed: F.banco() });
  await page.getByRole("button", { name: /Sou Aluno/ }).click();
  await page.locator("#laNome").fill("Ana Souza");
  await page.locator("#laSenha").fill("senha123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#app")).toContainText("Olá, Ana Souza");
  expect(app.errosPagina).toEqual([]);
});
