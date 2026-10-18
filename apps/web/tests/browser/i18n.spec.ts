import { test, expect } from "./harness";

test("header language changes the workflow without replacing entered form values",async({page,harnessUrl})=>{
  await page.goto(`${harnessUrl}/?component=workflow`);
  const language=page.getByRole("combobox",{name:"Interface language",exact:true});
  await expect(language).toBeVisible();
  await page.getByRole("button",{name:"＋ New patient",exact:true}).click();
  await page.getByRole("textbox",{name:"First name",exact:true}).fill("Keep my input");
  // A native dialog makes the application header inert. The stored preference can
  // change in another tab while the form is open, without discarding this form.
  await page.evaluate(()=>{localStorage.setItem("careiq-staff-locale","es");window.dispatchEvent(new StorageEvent("storage",{key:"careiq-staff-locale",newValue:"es"}));});
  await expect(page.getByRole("textbox",{name:"Nombre",exact:true})).toHaveValue("Keep my input");
  await expect(page.locator("html")).toHaveAttribute("lang","es");
  await expect(page.getByRole("button",{name:"Cancelar",exact:true})).toBeVisible();
});

test("locale preference survives reload and keeps workflow command codes unchanged",async({page,harnessUrl})=>{
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("combobox",{name:"Interface language",exact:true}).selectOption("es");
  await expect(page.getByRole("button",{name:"Pacientes",exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox",{name:"Idioma de la interfaz",exact:true})).toHaveValue("es");
  await page.getByRole("button",{name:"Hoy",exact:true}).click();
  await page.getByRole("button",{name:/Alex Morgan/}).first().click();
  const status=page.getByRole("combobox",{name:"Estado de la visita",exact:true});
  await status.selectOption("in_progress");
  await expect.poll(()=>page.evaluate(()=>window.__careiqMockCalls.filter(call=>call.name==="workflowCommand").at(-1)?.input)).toMatchObject({body:{status:"in_progress"}});
});

test("patient interface language is independent from the staff preference",async({page,harnessUrl})=>{
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("combobox",{name:"Interface language",exact:true}).selectOption("es");
  await page.goto(`${harnessUrl}/?component=patient-workflow`);
  await expect(page.getByRole("combobox",{name:"Interface language",exact:true})).toHaveValue("en");
  await page.getByRole("combobox",{name:"Interface language",exact:true}).selectOption("es");
  await expect(page.getByRole("combobox",{name:"Idioma de la interfaz",exact:true})).toHaveValue("es");
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem("careiq-staff-locale"))).toBe("es");
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem("careiq-patient-locale"))).toBe("es");
});

test("dropdown picker has padded options, selected styling and keyboard behavior",async({page,harnessUrl})=>{
  await page.goto(`${harnessUrl}/?component=workflow`);
  const language=page.getByRole("combobox",{name:"Interface language",exact:true});
  await expect.poll(()=>page.evaluate(()=>CSS.supports("appearance","base-select"))).toBe(true);
  const styles=await language.evaluate(select=>({picker:getComputedStyle(select,"::picker(select)").padding,shadow:getComputedStyle(select,"::picker(select)").boxShadow,option:getComputedStyle(select.querySelector("option")!).padding}));
  expect(styles.picker).toBe("8px");
  expect(styles.shadow).not.toBe("none");
  expect(styles.option).toBe("11px 12px");
  await language.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox",{name:"Idioma de la interfaz",exact:true})).toHaveValue("es");
});

test("Spanish layout and popup controls fit at a narrow width",async({page,harnessUrl})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("combobox",{name:"Interface language",exact:true}).selectOption("es");
  await expect(page.getByRole("button",{name:"Pacientes",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test("an existing failed-save notice follows the new language and preserves the draft",async({page,harnessUrl})=>{
  await page.goto(`${harnessUrl}/?component=workflow&scenario=save-failure`);
  await page.getByRole("button",{name:"＋ New patient",exact:true}).click();
  await page.getByLabel("First name",{exact:true}).fill("Preserved");
  await page.getByLabel("Last name",{exact:true}).fill("Patient");
  await page.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("The change could not be saved");
  await page.evaluate(()=>{localStorage.setItem("careiq-staff-locale","es");window.dispatchEvent(new StorageEvent("storage",{key:"careiq-staff-locale",newValue:"es"}));});
  await expect(page.getByRole("alert")).toContainText("No se pudo guardar el cambio");
  await expect(page.getByLabel("Nombre",{exact:true})).toHaveValue("Preserved");
  expect(await page.evaluate(()=>window.__careiqMockCalls.filter(call=>call.name==="workflowCommand").length)).toBe(1);
});


test("account language saves are serialized and an older profile update cannot replace the latest choice", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=locale-account`);
  const language = page.locator("select.cq-language-select");
  await expect(language).toHaveValue("en");
  await language.selectOption("es");
  await expect.poll(() => page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ active: 1, maximumActive: 1, writes: ["es"] });
  await language.selectOption("en");
  // The second write waits for the first one instead of racing it.
  expect(await page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ active: 1, maximumActive: 1, writes: ["es"] });
  await page.evaluate(() => window.__careiqLocaleAccount!.resolveNext());
  await expect.poll(() => page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ active: 1, maximumActive: 1, writes: ["es", "en"], storedLocale: "es" });
  await expect(language).toHaveValue("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => window.__careiqLocaleAccount!.resolveNext());
  await expect.poll(() => page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ active: 0, maximumActive: 1, storedLocale: "en" });
  await expect(language).toHaveValue("en");
  expect(await page.evaluate(() => localStorage.getItem("careiq-staff-locale"))).toBe("en");
});

test("a late initial account preference preserves and saves an earlier manual language choice", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=locale-account&account=late`);
  const language = page.locator("select.cq-language-select");
  await language.selectOption("es");
  await expect(language).toHaveValue("es");
  expect(await page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ loaded: false, active: 0, writes: [], storedLocale: "en" });
  await page.evaluate(() => window.__careiqLocaleAccount!.load());
  await expect.poll(() => page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ loaded: true, active: 1, maximumActive: 1, writes: ["es"] });
  await expect(language).toHaveValue("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.evaluate(() => window.__careiqLocaleAccount!.resolveNext());
  await expect.poll(() => page.evaluate(() => window.__careiqLocaleAccount?.snapshot())).toMatchObject({ active: 0, storedLocale: "es" });
  await expect(language).toHaveValue("es");
});
