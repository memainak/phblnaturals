#!/usr/bin/env node
/**
 * PHBL Naturals: one-time Admin data setup.
 * Creates metaobject definitions, product/article metafield definitions, and tag-based automated collections.
 * Safe to re-run: "already exists" errors are reported and skipped.
 *
 * Usage:
 *   SHOPIFY_STORE=phbl-naturals.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx node scripts/setup-store-data.mjs
 *
 * Token: Admin > Settings > Apps and sales channels > Develop apps > create app with scopes
 *   write_metaobject_definitions, write_metaobjects, write_products, write_content (for article metafields)
 */
const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API = '2025-10';
if (!STORE || !TOKEN) {
  console.error('Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/${API}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ---------- 1. Metaobject definitions ----------
const f = (key, name, type, extra = {}) => ({ key, name, type, ...extra });
const METAOBJECTS = [
  { type: 'benefit', name: 'Benefit', displayNameKey: 'title', fields: [f('title', 'Title', 'single_line_text_field', { required: true }), f('icon', 'Icon', 'file_reference')] },
  { type: 'faq', name: 'FAQ', displayNameKey: 'question', fields: [f('question', 'Question', 'single_line_text_field', { required: true }), f('answer', 'Answer', 'rich_text_field', { required: true }), f('category', 'Category (FAQ page grouping)', 'single_line_text_field')] },
  { type: 'concern', name: 'Concern', displayNameKey: 'name', fields: [f('name', 'Name', 'single_line_text_field', { required: true }), f('icon', 'Icon / image', 'file_reference'), f('collection', 'Linked collection', 'collection_reference')] },
  { type: 'ingredient', name: 'Ingredient', displayNameKey: 'name', fields: [f('name', 'Name', 'single_line_text_field', { required: true }), f('image', 'Image', 'file_reference'), f('short_description', 'Short description', 'multi_line_text_field'), f('collection', 'Linked collection', 'collection_reference')] },
  { type: 'testimonial', name: 'Testimonial', displayNameKey: 'name', fields: [f('name', 'Name', 'single_line_text_field', { required: true }), f('photo', 'Photo', 'file_reference'), f('title', 'Title / city', 'single_line_text_field'), f('quote', 'Quote', 'multi_line_text_field', { required: true }), f('product', 'Product', 'product_reference')] },
];

const defIds = {};
async function createMetaobjects() {
  const existing = await gql(`{ metaobjectDefinitions(first: 50) { nodes { id type } } }`);
  existing.metaobjectDefinitions.nodes.forEach((d) => (defIds[d.type] = d.id));
  for (const m of METAOBJECTS) {
    if (defIds[m.type]) {
      console.log(`= metaobject ${m.type} exists`);
      continue;
    }
    const d = await gql(
      `mutation($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message } }
      }`,
      {
        definition: {
          type: m.type,
          name: m.name,
          displayNameKey: m.displayNameKey,
          access: { storefront: 'PUBLIC_READ' }, // required for shop.metaobjects in Liquid
          capabilities: { publishable: { enabled: true } },
          fieldDefinitions: m.fields,
        },
      }
    );
    const r = d.metaobjectDefinitionCreate;
    if (r.userErrors.length) console.warn(`! ${m.type}`, r.userErrors);
    else {
      defIds[m.type] = r.metaobjectDefinition.id;
      console.log(`+ metaobject ${m.type}`);
    }
  }
}

// ---------- 2. Metafield definitions ----------
const mref = (type) => ({ validations: [{ name: 'metaobject_definition_id', value: defIds[type] }] });
const PRODUCT_FIELDS = () => [
  ['benefit_tagline', 'Benefit tagline', 'single_line_text_field'],
  ['suitable_for', 'Suitable for', 'single_line_text_field'],
  ['key_benefits', 'Key benefits', 'list.metaobject_reference', mref('benefit')],
  ['key_ingredients', 'Key ingredients', 'list.metaobject_reference', mref('ingredient')],
  ['concerns', 'Concerns', 'list.metaobject_reference', mref('concern')],
  ['how_to_use', 'How to use', 'rich_text_field'],
  ['full_ingredients', 'Full ingredients', 'multi_line_text_field'],
  ['faqs', 'FAQs', 'list.metaobject_reference', mref('faq')],
  ['badge', 'Badge', 'single_line_text_field', { validations: [{ name: 'choices', value: JSON.stringify(['BESTSELLER', 'NEW', 'TRENDING', 'TOP PICK']) }] }],
  ['hover_image', 'Hover image', 'file_reference'],
  ['frequently_bought_together', 'Frequently bought together', 'list.product_reference'],
  ['combo_items', 'Combo items (combos only)', 'list.product_reference'],
  ['video', 'Product video', 'file_reference'],
  ['net_quantity', 'Net quantity (e.g. 100 ml)', 'single_line_text_field'],
  ['manufacturer', 'Manufactured by (name + address)', 'multi_line_text_field'],
  ['marketed_by', 'Marketed by (name + address)', 'multi_line_text_field'],
  ['country_of_origin', 'Country of origin', 'single_line_text_field'],
  ['licence_no', 'Licence no. (Cosmetic / AYUSH)', 'single_line_text_field'],
  ['bought_count', 'Units bought in last 90 days (real number only)', 'number_integer'],
];

async function createMetafields() {
  const defs = [
    ...PRODUCT_FIELDS().map(([key, name, type, extra = {}]) => ({ ownerType: 'PRODUCT', key, name, type, ...extra })),
    { ownerType: 'ARTICLE', key: 'products', name: 'Products in article', type: 'list.product_reference' },
  ];
  for (const d of defs) {
    const r = (
      await gql(
        `mutation($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { code message } }
        }`,
        { definition: { namespace: 'custom', pin: true, access: { storefront: 'PUBLIC_READ' }, ...d } }
      )
    ).metafieldDefinitionCreate;
    const taken = r.userErrors.some((e) => e.code === 'TAKEN');
    console.log(r.userErrors.length ? (taken ? `= ${d.ownerType}.${d.key} exists` : `! ${d.key} ${JSON.stringify(r.userErrors)}`) : `+ ${d.ownerType}.custom.${d.key}`);
  }
}

// ---------- 3. Automated collections by tag ----------
// Tag convention: bestseller, new-launch, combo, cat-<category>, concern-<concern>, ing-<ingredient>
const COLLECTIONS = [
  ['Bestsellers', 'bestsellers', 'bestseller'],
  ['New Launches', 'new-launches', 'new-launch'],
  ['Combos', 'combos', 'combo'],
  ['Offers', 'offers', 'offer'],
  ['Face Care', 'face-care', 'cat-face'],
  ['Hair Care', 'hair-care', 'cat-hair'],
  ['Body Care', 'body-care', 'cat-body'],
  ['Lip Care', 'lip-care', 'cat-lip'],
  ['Acne & Oil Control', 'concern-acne', 'concern-acne'],
  ['Dryness', 'concern-dryness', 'concern-dryness'],
  ['Dull Skin', 'concern-dullness', 'concern-dullness'],
  ['Hair Fall', 'concern-hair-fall', 'concern-hair-fall'],
  ['Dandruff', 'concern-dandruff', 'concern-dandruff'],
  ['Neem', 'ingredient-neem', 'ing-neem'],
  ['Aloe Vera', 'ingredient-aloe-vera', 'ing-aloe-vera'],
  ['Turmeric', 'ingredient-turmeric', 'ing-turmeric'],
];

async function createCollections() {
  for (const [title, handle, tag] of COLLECTIONS) {
    const exists = (await gql(`query($h: String!) { collectionByHandle(handle: $h) { id } }`, { h: handle })).collectionByHandle;
    if (exists) {
      console.log(`= collection ${handle} exists`);
      continue;
    }
    const r = (
      await gql(
        `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { message } } }`,
        { input: { title, handle, sortOrder: 'BEST_SELLING', ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TAG', relation: 'EQUALS', condition: tag }] } } }
      )
    ).collectionCreate;
    console.log(r.userErrors.length ? `! ${handle} ${JSON.stringify(r.userErrors)}` : `+ collection ${handle} (tag: ${tag})`);
  }
  console.log('\nRemember: publish the new collections to the Online Store sales channel.');
}

await createMetaobjects();
await createMetafields();
await createCollections();
console.log('\nDone. Next: add concern/ingredient/benefit/faq/testimonial entries in Admin > Content > Metaobjects and link each concern/ingredient to its collection.');
