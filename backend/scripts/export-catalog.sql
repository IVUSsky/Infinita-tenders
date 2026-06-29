SELECT json_agg(row_to_json(q)) FROM (
  SELECT pc.id,
         COALESCE(pc.name->>'bg_BG', pc.name->>'en_US') AS name,
         pc.parent_id AS parent,
         count(*) AS count,
         (array_agg(COALESCE(pt.name->>'bg_BG', pt.name->>'en_US') ORDER BY pt.id))[1:20] AS samples
  FROM product_public_category pc
  JOIN product_public_category_product_template_rel rel ON rel.product_public_category_id = pc.id
  JOIN product_template pt ON pt.id = rel.product_template_id
  WHERE pt.active
  GROUP BY pc.id, pc.name, pc.parent_id
  ORDER BY count DESC
) q;
