#!/usr/bin/env python3
"""
Test P1 firmware with different version formats
"""
import requests
import xml.etree.ElementTree as ET

def test_p1_version(version, model="hidock-p1"):
    access_token = "M4XoUFm5OOygd5snWe10lMxtSqadM2KOp2wWObw554iUyTaEZbVXdu11TZ3zD4SD"
    
    session = requests.Session()
    session.headers.update({'AccessToken': access_token})
    
    endpoint = "https://hinotes.hidock.com/v2/device/firmware/latest"
    data = {
        'version': version,
        'model': model
    }
    
    try:
        response = session.post(endpoint, data=data)
        if response.status_code != 200:
            print(f"Version {version}: HTTP {response.status_code}")
            return None
        
        root = ET.fromstring(response.text)
        error_code = root.find('error').text if root.find('error') is not None else None
        message = root.find('message').text if root.find('message') is not None else None
        
        if root.find('data') is not None:
            data_elem = root.find('data')
            id_elem = data_elem.find('id')
            version_elem = data_elem.find('versionCode')
            
            if id_elem is not None and id_elem.text:
                print(f"Version {version}: SUCCESS! ID={id_elem.text}, Latest={version_elem.text if version_elem is not None else 'None'}")
                return True
            else:
                print(f"Version {version}: No firmware ID (probably up to date)")
        else:
            print(f"Version {version}: No data element")
        
    except Exception as e:
        print(f"Version {version}: Error - {e}")
    
    return False

# Test different version formats for P1
version_tests = [
    # Numeric versions (lower range)
    "0", "1", "10", "100", "1000", 
    # Maybe P1 uses different encoding
    "10000", "60000", "65000", "65800",
    # String versions (maybe P1 uses semantic versions)
    "1.0.0", "1.2.0", "1.2.24", "0.0.1"
]

print("Testing P1 firmware with different version formats:")
print("=" * 50)

for version in version_tests:
    success = test_p1_version(version)
    if success:
        print(f"*** FOUND WORKING VERSION: {version} ***")
        break

print("\nTesting with different model names:")
model_tests = ["hidock-p1", "p1", "hidock_p1", "HiDock-P1"]
for model in model_tests:
    print(f"\nTesting model: {model}")
    test_p1_version("1000", model)