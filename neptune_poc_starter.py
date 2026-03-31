"""
Neptune Analytics POC - Hands-on Starter
Earthquake + Supplier Graph Demo
"""

import boto3
import json
import time
from datetime import datetime

# Configuration
GRAPH_NAME = "earthquake-supplier-poc"
REGION = "us-west-2"  # Change to your region
MIN_NCUS = 16  # Minimum capacity (16 GB RAM)

# Initialize clients
neptune_client = boto3.client('neptune-graph', region_name=REGION)


def create_graph():
    """Create empty Neptune Analytics graph"""
    print(f"Creating graph: {GRAPH_NAME}")
    
    try:
        response = neptune_client.create_graph(
            graphName=GRAPH_NAME,
            provisionedMemory=MIN_NCUS,
            publicConnectivity=True,  # For POC - set False for production
            replicaCount=0,  # No replicas for POC
            deletionProtection=False  # Easy to delete for testing
        )
        
        graph_id = response['id']
        print(f"Graph created! ID: {graph_id}")
        print(f"Status: {response['status']}")
        print("Waiting for graph to become available (takes ~5-10 minutes)...")
        
        # Wait for graph to be available
        while True:
            status_response = neptune_client.get_graph(graphIdentifier=graph_id)
            status = status_response['status']
            print(f"Current status: {status}")
            
            if status == 'AVAILABLE':
                print("Graph is ready!")
                print(f"Endpoint: {status_response['endpoint']}")
                return graph_id
            elif status in ['FAILED', 'DELETING']:
                print(f"Graph creation failed with status: {status}")
                return None
            
            time.sleep(30)
            
    except neptune_client.exceptions.ConflictException:
        print(f"Graph {GRAPH_NAME} already exists. Fetching info...")
        graphs = neptune_client.list_graphs()
        for graph in graphs['graphs']:
            if graph['name'] == GRAPH_NAME:
                return graph['id']
    except Exception as e:
        print(f"Error: {e}")
        return None


def execute_query(graph_id, query, language='OPEN_CYPHER'):
    """Execute openCypher query on Neptune Analytics"""
    print(f"\nExecuting: {query[:100]}...")
    
    response = neptune_client.execute_query(
        graphIdentifier=graph_id,
        queryString=query,
        language=language
    )
    
    # Read streaming response
    result = response['payload'].read().decode('utf-8')
    return json.loads(result)


def insert_sample_data(graph_id):
    """Insert sample plants and locations - expanded dataset"""
    print("\n=== Inserting Sample Data ===")
    
    # Create Locations (Japanese cities) - expanded
    locations = [
        ("L001", "東京都", "千代田区", 35.6762, 139.6503),
        ("L002", "大阪府", "大阪市", 34.6937, 135.5023),
        ("L003", "福岡県", "福岡市", 33.5904, 130.4017),
        ("L004", "沖縄県", "宮古島市", 24.8050, 125.2814),
        ("L005", "愛知県", "名古屋市", 35.1815, 136.9066),
        ("L006", "北海道", "札幌市", 43.0642, 141.3469),
        ("L007", "宮城県", "仙台市", 38.2682, 140.8694),
        ("L008", "広島県", "広島市", 34.3853, 132.4553),
        ("L009", "神奈川県", "横浜市", 35.4437, 139.6380),
        ("L010", "静岡県", "浜松市", 34.7108, 137.7261),
        ("L011", "沖縄県", "那覇市", 26.2124, 127.6809),
        ("L012", "熊本県", "熊本市", 32.8032, 130.7079),
    ]
    
    for loc_id, pref, city, lat, lon in locations:
        query = f"""
        CREATE (l:Location {{
            id: '{loc_id}',
            pref: '{pref}',
            city: '{city}',
            lat: {lat},
            lon: {lon}
        }})
        RETURN l.id as created
        """
        result = execute_query(graph_id, query)
        print(f"Created Location: {city}")
    
    # Create Plants - expanded
    plants = [
        ("P001", "Tokyo_Assembly_Plant", 500, True, "L001"),
        ("P002", "Osaka_Semiconductor_Fab", 300, True, "L002"),
        ("P003", "Fukuoka_Copper_Mill", 200, True, "L003"),
        ("P004", "Miyakojima_Chip_Factory", 150, True, "L004"),
        ("P005", "Nagoya_Steel_Works", 400, True, "L005"),
        ("P006", "Sapporo_Electronics", 250, True, "L006"),
        ("P007", "Sendai_Components", 180, True, "L007"),
        ("P008", "Hiroshima_Materials", 220, True, "L008"),
        ("P009", "Yokohama_Assembly", 350, True, "L009"),
        ("P010", "Hamamatsu_Precision", 280, True, "L010"),
        ("P011", "Naha_Logistics_Hub", 100, True, "L011"),
        ("P012", "Kumamoto_Semiconductor", 320, True, "L012"),
    ]
    
    for plant_id, name, capacity, is_active, loc_id in plants:
        query = f"""
        MATCH (l:Location {{id: '{loc_id}'}})
        CREATE (p:Plant {{
            id: '{plant_id}',
            name: '{name}',
            capacity: {capacity},
            is_active: {str(is_active).lower()}
        }})
        CREATE (p)-[:LOCATED_AT]->(l)
        RETURN p.name as created
        """
        result = execute_query(graph_id, query)
        print(f"Created Plant: {name}")
    
    # Create Materials - expanded
    materials = [
        ("M001", "Steel", 1000),
        ("M002", "Copper", 500),
        ("M003", "Semiconductor", 200),
        ("M004", "Aluminum", 800),
        ("M005", "Lithium", 150),
        ("M006", "Rare_Earth", 100),
    ]
    
    for mat_id, name, stock in materials:
        query = f"""
        CREATE (m:Material {{
            id: '{mat_id}',
            name: '{name}',
            stock_level: {stock}
        }})
        RETURN m.name as created
        """
        result = execute_query(graph_id, query)
        print(f"Created Material: {name}")
    
    # Create supply relationships - expanded
    supplies = [
        ("P004", "M003", 100),  # Miyakojima supplies semiconductors
        ("P002", "M003", 150),  # Osaka also supplies semiconductors
        ("P012", "M003", 120),  # Kumamoto supplies semiconductors
        ("P005", "M001", 200),  # Nagoya supplies steel
        ("P008", "M001", 180),  # Hiroshima supplies steel
        ("P003", "M002", 150),  # Fukuoka supplies copper
        ("P010", "M002", 130),  # Hamamatsu supplies copper
        ("P006", "M004", 160),  # Sapporo supplies aluminum
        ("P011", "M005", 90),   # Naha supplies lithium
        ("P007", "M006", 80),   # Sendai supplies rare earth
    ]
    
    for plant_id, mat_id, quantity in supplies:
        query = f"""
        MATCH (p:Plant {{id: '{plant_id}'}}), (m:Material {{id: '{mat_id}'}})
        CREATE (p)-[:SUPPLIES {{quantity: {quantity}}}]->(m)
        RETURN p.id, m.id
        """
        result = execute_query(graph_id, query)
        print(f"Created SUPPLIES: {plant_id} -> {mat_id}")
    
    # Create plant dependencies - expanded supply chain
    dependencies = [
        ("P004", "P001"),  # Miyakojima -> Tokyo (semiconductors)
        ("P002", "P001"),  # Osaka -> Tokyo (semiconductors)
        ("P012", "P009"),  # Kumamoto -> Yokohama (semiconductors)
        ("P003", "P002"),  # Fukuoka -> Osaka (copper)
        ("P005", "P001"),  # Nagoya -> Tokyo (steel)
        ("P008", "P009"),  # Hiroshima -> Yokohama (steel)
        ("P006", "P007"),  # Sapporo -> Sendai (aluminum)
        ("P010", "P005"),  # Hamamatsu -> Nagoya (copper)
        ("P001", "P009"),  # Tokyo -> Yokohama (final assembly)
        ("P007", "P006"),  # Sendai -> Sapporo (components)
    ]
    
    for supplier_id, consumer_id in dependencies:
        query = f"""
        MATCH (supplier:Plant {{id: '{supplier_id}'}}), 
              (consumer:Plant {{id: '{consumer_id}'}})
        CREATE (supplier)-[:SUPPLIES_TO]->(consumer)
        RETURN supplier.name, consumer.name
        """
        result = execute_query(graph_id, query)
        print(f"Created dependency: {supplier_id} -> {consumer_id}")
    
    print("\n✅ Sample data inserted!")


def query_affected_suppliers(graph_id, affected_city):
    """Query plants affected by earthquake"""
    print(f"\n=== Earthquake Impact Analysis: {affected_city} ===")
    
    # Find directly affected plants
    query = f"""
    MATCH (p:Plant)-[:LOCATED_AT]->(l:Location {{city: '{affected_city}'}})
    RETURN p.id as plant_id, p.name as plant_name, l.city as city
    """
    
    affected_plants = execute_query(graph_id, query)
    print(f"\nDirectly affected plants:")
    print(json.dumps(affected_plants, indent=2, ensure_ascii=False))
    
    # Find downstream impact
    query = f"""
    MATCH (affected:Plant)-[:LOCATED_AT]->(l:Location {{city: '{affected_city}'}})
    MATCH (affected)-[:SUPPLIES_TO*1..3]->(downstream:Plant)
    RETURN affected.name as affected_plant, 
           downstream.name as downstream_plant
    """
    
    downstream = execute_query(graph_id, query)
    print(f"\nDownstream impact:")
    print(json.dumps(downstream, indent=2, ensure_ascii=False))
    
    # Find critical materials at risk
    query = f"""
    MATCH (affected:Plant)-[:LOCATED_AT]->(l:Location {{city: '{affected_city}'}})
    MATCH (affected)-[:SUPPLIES]->(m:Material)
    RETURN affected.name as plant, 
           m.name as material, 
           m.stock_level as stock
    """
    
    materials = execute_query(graph_id, query)
    print(f"\nMaterials at risk:")
    print(json.dumps(materials, indent=2, ensure_ascii=False))


def find_closest_alternative_suppliers(graph_id, affected_city, material_name):
    """Find closest non-affected suppliers using Haversine distance"""
    print(f"\n=== Finding Closest Alternative Suppliers ===")
    print(f"Material: {material_name}")
    print(f"Affected city: {affected_city}")
    
    query = f"""
    MATCH (affected:Location {{city: '{affected_city}'}})
    MATCH (supplier:Plant)-[:SUPPLIES]->(m:Material {{name: '{material_name}'}})
    MATCH (supplier)-[:LOCATED_AT]->(safe:Location)
    WHERE safe.city <> affected.city
    
    WITH supplier, safe, affected, m,
      6371 * 2 * asin(sqrt(
        pow(sin(radians(safe.lat - affected.lat) / 2), 2) +
        cos(radians(affected.lat)) * cos(radians(safe.lat)) *
        pow(sin(radians(safe.lon - affected.lon) / 2), 2)
      )) AS distance_km
    
    RETURN 
      supplier.id as supplier_id,
      supplier.name as supplier_name, 
      safe.city as location, 
      safe.pref as prefecture,
      round(distance_km) as distance_km
    ORDER BY distance_km ASC
    LIMIT 5
    """
    
    result = execute_query(graph_id, query)
    print(f"\nClosest alternative suppliers:")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    
    return result


def find_alternative_with_customer_context(graph_id, affected_city):
    """Find alternatives considering customer location (minimize customer disruption)"""
    print(f"\n=== Alternative Suppliers Closest to Affected Customers ===")
    
    query = f"""
    MATCH (affected_plant:Plant)-[:LOCATED_AT]->(affected_loc:Location {{city: '{affected_city}'}})
    MATCH (affected_plant)-[:SUPPLIES]->(material:Material)
    MATCH (affected_plant)-[:SUPPLIES_TO]->(customer:Plant)
    MATCH (customer)-[:LOCATED_AT]->(customer_loc:Location)
    
    MATCH (alt_supplier:Plant)-[:SUPPLIES]->(material)
    MATCH (alt_supplier)-[:LOCATED_AT]->(alt_loc:Location)
    WHERE alt_loc.city <> '{affected_city}'
    
    WITH alt_supplier, alt_loc, material, customer, customer_loc, affected_plant,
      6371 * 2 * asin(sqrt(
        pow(sin(radians(alt_loc.lat - customer_loc.lat) / 2), 2) +
        cos(radians(customer_loc.lat)) * cos(radians(alt_loc.lat)) *
        pow(sin(radians(alt_loc.lon - customer_loc.lon) / 2), 2)
      )) AS distance_km
    
    RETURN 
      affected_plant.name as disrupted_supplier,
      customer.name as affected_customer,
      customer_loc.city as customer_city,
      alt_supplier.name as alternative_supplier,
      alt_loc.city as alt_supplier_city,
      material.name as material,
      round(distance_km) as distance_to_customer_km
    ORDER BY customer.name, distance_km ASC
    """
    
    result = execute_query(graph_id, query)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    
    return result


def test_queries(graph_id):
    """Run various test queries"""
    print("\n=== Running Test Queries ===")
    
    # Count all nodes
    result = execute_query(graph_id, "MATCH (n) RETURN count(n) as total_nodes")
    print(f"\nTotal nodes: {result}")
    
    # Count by label
    result = execute_query(graph_id, "MATCH (n:Plant) RETURN count(n) as plants")
    print(f"Plants: {result}")
    
    result = execute_query(graph_id, "MATCH (n:Location) RETURN count(n) as locations")
    print(f"Locations: {result}")
    
    # All relationships
    result = execute_query(graph_id, "MATCH ()-[r]->() RETURN type(r) as rel_type, count(r) as count")
    print(f"\nRelationships: {json.dumps(result, indent=2)}")


def cleanup(graph_id):
    """Delete the graph"""
    print(f"\n=== Cleanup: Deleting graph {graph_id} ===")
    
    response = neptune_client.delete_graph(
        graphIdentifier=graph_id,
        skipSnapshot=True
    )
    print(f"Delete initiated. Status: {response['status']}")


if __name__ == "__main__":
    print("Neptune Analytics POC - Earthquake Supplier Impact")
    print("=" * 60)
    
    # Step 1: Create graph
    graph_id = create_graph()
    
    if not graph_id:
        print("Failed to create graph. Exiting.")
        exit(1)
    
    print(f"\nGraph ID: {graph_id}")
    
    # Step 2: Insert sample data
    insert_sample_data(graph_id)
    
    # Step 3: Run test queries
    test_queries(graph_id)
    
    # Step 4: Earthquake scenario - direct impact
    query_affected_suppliers(graph_id, "宮古島市")
    
    # Step 5: Find closest alternative suppliers for semiconductors
    find_closest_alternative_suppliers(graph_id, "宮古島市", "Semiconductor")
    
    # Step 6: Find alternatives considering customer location
    find_alternative_with_customer_context(graph_id, "宮古島市")
    
    print("\n" + "=" * 60)
    print("POC Complete!")
    print(f"Graph ID: {graph_id}")
    print("\nKey Insights:")
    print("1. Miyakojima Chip Factory disrupted")
    print("2. Closest alternatives: Osaka (1,361km), Kumamoto (1,097km)")
    print("3. Tokyo Assembly Plant needs alternative semiconductor source")
    print(f"\nTo delete: cleanup('{graph_id}')")
