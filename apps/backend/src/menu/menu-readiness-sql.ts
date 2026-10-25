// The ONE definition of "the shop has a first sellable dish" (issue #190, step 4 of the setup): a dish that is on sale (VISIBLE, not hidden or deleted),
// has a valid price (> 0; the table CHECK already forbids less) and has a picture that exists (the foreign key guarantees it). The group of the dish
// is NOT part of it: a group that was switched off is not a reason to hide a dish. Used by the readiness reader below and, as a fragment, by the
// administration list, so a list never disagrees with the customer about whether a shop has a sellable dish.

export function sellableItemExistsSql(shopIdRef: string): string {
  return `EXISTS (
         SELECT 1
           FROM app.menu_items si
          WHERE si.shop_id = ${shopIdRef}
            AND si.status = 'VISIBLE'
            AND si.price_vnd > 0
            AND si.image_id IS NOT NULL
       )`;
}
