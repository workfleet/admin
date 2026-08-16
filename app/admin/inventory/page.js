'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { KIT_PRODUCTS } from '../../../lib/kitProducts';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';

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

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('products')
      .select('id, name, stock_level, reorder_threshold, location, supplier, unit_price')
      .order('name');
    setProducts(data || []);
    setLoading(false);
  };

  const adjustStock = async (product, delta) => {
    // Computed inside the setState updater (always given the latest state)
    // rather than off the closed-over `product` param - two clicks fired
    // before a re-render would otherwise both read the same stale
    // stock_level and silently lose one of the increments.
    let newLevel = product.stock_level;
    setProducts((prev) => prev.map((p) => {
      if (p.id !== product.id) return p;
      newLevel = Math.max(0, Math.round((p.stock_level + delta) * 100) / 100);
      return { ...p, stock_level: newLevel };
    }));
    const { error } = await supabase.from('products').update({ stock_level: newLevel }).eq('id', product.id);
    if (error) { toast.error('Could not update stock.'); load(); }
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

  const seedDefaults = async () => {
    const existingNames = new Set(products.map((p) => p.name));
    const missing = KIT_PRODUCTS.filter((name) => !existingNames.has(name));
    if (missing.length === 0) { toast.error('All kit products are already in the list.'); return; }

    const { data, error } = await supabase
      .from('products')
      .insert(missing.map((name) => ({ name, stock_level: 0, reorder_threshold: 5 })))
      .select();

    if (error) { toast.error('Could not seed products.'); return; }
    setProducts((prev) => [...prev, ...(data || [])].sort((a, b) => a.name.localeCompare(b.name)));
    toast.success(`Added ${data.length} product${data.length === 1 ? '' : 's'} from the kit list.`);
  };

  const deleteProduct = async (product) => {
    if (!(await confirm(`Remove "${product.name}" from inventory tracking?`, { danger: true }))) return;
    const { error } = await supabase.from('products').delete().eq('id', product.id);
    if (error) { toast.error('Could not remove this product.'); return; }
    setProducts((prev) => prev.filter((p) => p.id !== product.id));
    toast.success('Product removed.');
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.location, p.supplier].some((v) => v?.toLowerCase().includes(q))
    );
  }, [products, search]);

  if (loading) return <div className="page-inner">Loading...</div>;

  const lowStockCount = products.filter((p) => p.stock_level <= p.reorder_threshold).length;

  return (
    <div className="page-inner">
      <div className="page-header-row">
        <div>
          <h1>Inventory</h1>
          <p className="page-subtitle">
            {products.length} product{products.length === 1 ? '' : 's'} tracked
            {lowStockCount > 0 && ` · ${lowStockCount} low on stock`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={seedDefaults}>Add Kit List</button>
          <button className="btn-primary" onClick={() => setShowAddForm((s) => !s)}>
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
              <button type="submit" className="btn-primary">Add Product</button>
            </div>
          </form>
        </div>
      )}

      {products.length === 0 && <p className="empty-state">No products tracked yet - add one, or use "Add Kit List" to seed from your standard supplies.</p>}

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
        {filteredProducts.length === 0 && products.length > 0 && <p className="empty-state">No products match your search.</p>}
        {filteredProducts.map((p) => {
          const low = p.stock_level <= p.reorder_threshold;
          return (
            <div key={p.id} className="task-row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: low ? 'crimson' : 'var(--muted)' }}>
                  {low && 'Low stock · '}Reorder at {formatQty(p.reorder_threshold)}
                  {p.location && ` · ${p.location}`}
                  {p.supplier && ` · ${p.supplier}`}
                  {p.unit_price != null && ` · £${Number(p.unit_price).toFixed(2)}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => adjustStock(p, -1)} style={{ padding: '6px 8px' }} aria-label="Decrease">
                  <Minus size={14} />
                </button>
                <strong style={{ fontSize: 16, minWidth: 28, textAlign: 'center' }}>{formatQty(p.stock_level)}</strong>
                <button type="button" className="btn-secondary" onClick={() => adjustStock(p, 1)} style={{ padding: '6px 8px' }} aria-label="Increase">
                  <Plus size={14} />
                </button>
                <button type="button" className="btn-secondary" onClick={() => deleteProduct(p)} style={{ padding: '6px 8px' }} aria-label="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
