# Type system verified against a running instance

The merged type system built from the `items.xml` files was compared with what a running SAP Commerce 2211-jdk21
instance reports about itself (read-only FlexibleSearch over `ComposedType` and `AttributeDescriptor` through the hAC,
using the local development login). The comparison script lives outside the repository because it needs a live system;
the rules it found are covered by unit tests.

## Result

| Check                                                  | Result                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Item types present in both                             | 1,744 types in the database, 1,488 item types parsed (+ enums, relations, collections, maps) |
| Supertype of every common type                         | identical after the fixes below                                                              |
| Complete attribute set (own + inherited) per item type | 1,004 types compared: **999 identical**, 5 differ                                            |
| Relation types: `Link` only for many-to-many           | 480 relations: 143 many-to-many are `Link`, 337 one-to-many are `Item`; **no exception**     |

The 5 remaining differences (`MediaFormat`, `ConversionMediaFormat`, `ConversionErrorLog`, `ConversionGroup`,
`SAPConfiguration`) and the 13 types that exist only in the database all belong to extensions that the running database
knows (Cloudinary, SAP configuration) but that are **not** in this checkout's `localextensions.xml`. Four types exist only
in the checkout (an asset-related extension) because the database was not updated since. Both directions are therefore
differences between the system and the files, not between our parser and the platform.

## Rules this comparison found (fixed, tested in `typesystem.test.ts`)

1. **Only many-to-many relations are `Link` types** with `source`/`target` attributes. One-to-many relations are plain
   `Item` types without them. (Before: every relation was a `Link`, so ImpEx completion offered `source`/`target` for
   types that cannot be imported that way.)
2. **Ordered one-to-many relations add a position attribute** to the "many" type, named after the qualifier of the "one"
   end plus `POS`: `User2ContactInfos` → `AbstractContactInfo.userPOS`, `ItemSavedValuesRelation` → `SavedValues.modifiedItemPOS`.
3. **Type codes are resolved without regard to case.** `cms2-items.xml` refers to `CmsLinkComponent` and `CmsPageType`
   although the types are called `CMSLinkComponent` and `CMSPageType`; relation attributes must still land on them.

## How to repeat it

Run a script that builds the type system for the instance's `hybris` directory and compares it with
`SELECT {t:code},{s:code} FROM {ComposedType AS t LEFT JOIN ComposedType AS s ON {t:superType}={s:pk}}` and
`SELECT {e:code},{a:qualifier} FROM {AttributeDescriptor AS a JOIN ComposedType AS e ON {a:enclosingType}={e:pk}}`.
Compare complete attribute sets (own + inherited along the live supertype chain), because the platform also lists the six
core attributes (`creationtime`, `modifiedtime`, `itemtype`, `owner`, `pk`, `sealed`) and some inherited ones on subtypes.
