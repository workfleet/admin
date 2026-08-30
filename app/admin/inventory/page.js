'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Minus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { needsReorder } from '../../../lib/inventory';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

function formatQty(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export default function AdminInventory() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStock, setNewStock] = useState(0);
  const [newThreshold, setNewThreshold] = useState(5);
  const [newLocation, setNewLocation] = useState('');
  const [newSupplier, setNewSupplier] = useState('');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [shoppingListOpen, setShoppingListOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('products')
      .select('id, name, stock_level, reorder_threshold, location, supplier, unit_price')
      .order('name');
    setProducts(data || []);
    setLoading(false);
  };

  // Counting is staged in `draft` and only written on Save, so a stray tap
  // while scrolling the list no longer rewrites the database. The new level is
  // read out of the draft inside the updater rather than off the closed-over
  // `product`, so two clicks fired before a re-render can't both read the same
  // stale level and silently lose one of the increments.
  const adjustStock = (product, delta) => {
    setDraft((prev) => {
      const current = prev[product.id] ?? product.savedLevel;
      const next = Math.max(0, Math.round((current + delta) * 100) / 100);
      // Counted back to where it started, so there is nothing left to save.
      if (next === product.savedLevel) {
        const { [product.id]: _unchanged, ...rest } = prev;
        return rest;
      }
      return { ...prev, [product.id]: next };
    });
  };

  const saveStock = async () => {
    const entries = Object.entries(draft);
    if (entries.length === 0) return;

    setSaving(true);
    const results = await Promise.all(entries.map(([id, level]) =>
      supabase.from('products').update({ stock_level: level }).eq('id', id)
    ));
    setSaving(false);

    if (results.some((r) => r.error)) {
      // Some rows may have gone through - reload rather than guess which.
      toast.error('Could not save the stock counts.');
      setDraft({});
      load();
      return;
    }

    setProducts((prev) => prev.map((p) => (p.id in draft ? { ...p, stock_level: draft[p.id] } : p)));
    setDraft({});
    toast.success(`Stock saved for ${entries.length} product${entries.length === 1 ? '' : 's'}.`);
  };

  const discardChanges = async () => {
    if (!(await confirm('Discard your unsaved stock changes?', {
      danger: true,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep counting',
    }))) return;
    setDraft({});
  };

  const addProduct = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const { data, error } = await supabase
      .from('products')
      .insert({
        name: newName.trim(),
        stock_level: Number(newStock) || 0,
        reorder_threshold: Number(newThreshold) || 0,
        location: newLocation.trim() || null,
        supplier: newSupplier.trim() || null,
        unit_price: newUnitPrice === '' ? null : Number(newUnitPrice),
      })
      .select()
      .single();

    if (error) { toast.error('Could not add product - it may already exist.'); return; }
    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName('');
    setNewStock(0);
    setNewThreshold(5);
    setNewLocation('');
    setNewSupplier('');
    setNewUnitPrice('');
    setShowAddForm(false);
    toast.success('Product added.');
  };

  const deleteProduct = async (product) => {
    if (!(await confirm(`Remove "${product.name}" from inventory tracking?`, { danger: true }))) return;
    const { error } = await supabase.from('products').delete().eq('id', product.id);
    if (error) { toast.error('Could not remove this product.'); return; }
    setProducts((prev) => prev.filter((p) => p.id !== product.id));
    toast.success('Product removed.');
  };

  // Everything on screen reads the staged counts, so the low-stock flags and
  // the shopping list stay in step with what the numbers say. `savedLevel`
  // carries what is actually in the database, which is what the +/- buttons
  // measure against to tell an edit from a change counted back to where it was.
  const viewProducts = useMemo(
    () => products.map((p) => ({ ...p, savedLevel: p.stock_level, stock_level: draft[p.id] ?? p.stock_level })),
    [products, draft]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return viewProducts;
    return viewProducts.filter((p) =>
      [p.name, p.location, p.supplier].some((v) => v?.toLowerCase().includes(q))
    );
  }, [viewProducts, search]);

  const downloadShoppingList = async (kind) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/inventory/shopping-list/${kind}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) { toast.error('Could not generate the shopping list.'); return; }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match ? match[1] : `shopping-list.${kind}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const shoppingListItems = viewProducts.filter(needsReorder);
  const lowStockCount = shoppingListItems.length;
  const unsavedCount = Object.keys(draft).length;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Inventory</h1>
          <p className="page-subtitle">
            {products.length} product{products.length === 1 ? '' : 's'} tracked
            {lowStockCount > 0 && ` · ${lowStockCount} low on stock`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={() => setShowAddForm((s) => !s)} title="Add a product to the inventory">
            {showAddForm ? 'Cancel' : '+ Product'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="card job-form-card">
          <form onSubmit={addProduct}>
            <div className="job-form-body">
              <div className="field">
                <label className="field-label">Product name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Starting stock</label>
                  <input type="number" step="0.1" min="0" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Reorder threshold</label>
                  <input type="number" step="0.1" min="0" value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Location (optional)</label>
                  <input value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="e.g. Shelf 2" />
                </div>
                <div className="field">
                  <label className="field-label">Supplier (optional)</label>
                  <input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="e.g. Cotton & Sons" />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Unit price (optional)</label>
                <input type="number" step="0.01" min="0" value={newUnitPrice} onChange={(e) => setNewUnitPrice(e.target.value)} />
              </div>
            </div>
            <div className="job-form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" title="Save this product to the inventory">Add Product</button>
            </div>
          </form>
        </div>
      )}

      {products.length === 0 && <p className="empty-state">No products tracked yet - add one to get started.</p>}

      {products.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            onClick={() => shoppingListItems.length > 0 && setShoppingListOpen((o) => !o)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, cursor: shoppingListItems.length > 0 ? 'pointer' : 'default' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {shoppingListItems.length > 0 && (shoppingListOpen ? <ChevronUp size={18} color="var(--muted)" /> : <ChevronDown size={18} color="var(--muted)" />)}
              <div>
                <h2 style={{ margin: 0 }}>Shopping List</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 0' }}>
                  {shoppingListItems.length === 0 ? 'Nothing needs reordering right now.' : `${shoppingListItems.length} item${shoppingListItems.length === 1 ? '' : 's'} below reorder level`}
                </p>
              </div>
            </div>
            {shoppingListItems.length > 0 && (
              <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                {/* The downloads are built server-side from the saved counts,
                    so they'd contradict the screen while edits are pending. */}
                <button className="btn-secondary" disabled={unsavedCount > 0} onClick={() => downloadShoppingList('docx')} title={unsavedCount > 0 ? 'Save your stock changes first' : 'Download the shopping list as a Word document'}>Word</button>
                <button className="btn-secondary" disabled={unsavedCount > 0} onClick={() => downloadShoppingList('xlsx')} title={unsavedCount > 0 ? 'Save your stock changes first' : 'Download the shopping list as an Excel spreadsheet'}>Excel</button>
                <button className="btn-secondary" disabled={unsavedCount > 0} onClick={() => downloadShoppingList('pdf')} title={unsavedCount > 0 ? 'Save your stock changes first' : 'Download the shopping list as a PDF'}>PDF</button>
              </div>
            )}
          </div>

          {shoppingListOpen && shoppingListItems.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
              {shoppingListItems.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13.5 }}>
                  <span>{p.name}{p.supplier && <span style={{ color: 'var(--muted)' }}> · {p.supplier}</span>}</span>
                  <span style={{ color: 'var(--wf-overdue)' }}>{formatQty(p.stock_level)} / {formatQty(p.reorder_threshold)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {products.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, location, or supplier..."
          style={{
            width: '100%', padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-pill)',
            background: 'white', fontSize: 14, fontFamily: 'inherit', marginBottom: 16,
          }}
        />
      )}

      <div className="card">
        <div style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Stock levels</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '2px 0 0' }}>
            Counting here changes nothing until you press Save stock.
          </p>
        </div>

        {filteredProducts.length === 0 && products.length > 0 && <p className="empty-state">No products match your search.</p>}
        {filteredProducts.map((p) => {
          const low = needsReorder(p);
          const changed = p.id in draft;
          return (
            <div key={p.id} className="task-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: low ? 'var(--wf-overdue)' : 'var(--muted)' }}>
                  {low && 'Low stock · '}Reorder at {formatQty(p.reorder_threshold)}
                  {p.location && ` · ${p.location}`}
                  {p.supplier && ` · ${p.supplier}`}
                  {p.unit_price != null && ` · £${Number(p.unit_price).toFixed(2)}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => adjustStock(p, -1)} style={{ padding: '6px 8px' }} aria-label="Decrease" title="Take one off the stock count - not saved until you press Save stock">
                  <Minus size={14} />
                </button>
                <strong
                  style={{ fontSize: 16, minWidth: 28, textAlign: 'center', color: changed ? 'var(--brand-link)' : undefined }}
                  title={changed ? `Unsaved - ${formatQty(p.savedLevel)} until you press Save stock` : undefined}
                >
                  {formatQty(p.stock_level)}
                </strong>
                <button type="button" className="btn-secondary" onClick={() => adjustStock(p, 1)} style={{ padding: '6px 8px' }} aria-label="Increase" title="Add one to the stock count - not saved until you press Save stock">
                  <Plus size={14} />
                </button>
                <button type="button" className="btn-secondary" onClick={() => deleteProduct(p)} style={{ padding: '6px 8px' }} aria-label="Remove" title="Delete this product from the inventory">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {products.length > 0 && (
          <div
            style={{
              position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: 10, marginTop: 12, paddingTop: 12,
              borderTop: '1px solid var(--hairline)', background: 'var(--surface)',
            }}
          >
            <span style={{ fontSize: 13, color: unsavedCount > 0 ? 'var(--brand-link)' : 'var(--muted)' }}>
              {unsavedCount === 0
                ? 'Everything is saved.'
                : `${unsavedCount} unsaved change${unsavedCount === 1 ? '' : 's'}`}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={discardChanges} disabled={saving || unsavedCount === 0} title="Put the counts back to the saved figures">
                Discard
              </button>
              <button type="button" className="btn-primary" onClick={saveStock} disabled={saving || unsavedCount === 0} title="Write the new counts to the inventory">
                {saving ? 'Saving...' : 'Save stock'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
